"""
Windows Git Bash Detection

Detects git-bash (bash.exe from Git for Windows) for Claude Agent SDK.
The SDK requires bash.exe on Windows for its sandbox functionality.

Detection Priority:
1. CLAUDE_CODE_GIT_BASH_PATH environment variable (user override)
2. Standard Git installation paths (Program Files)
3. User-specific installations (LocalAppData, Scoop, Chocolatey)

Note: This detects bash.exe, NOT git.exe. They are different executables:
- git.exe: The Git CLI
- bash.exe: Unix shell bundled with Git for Windows (required by Claude SDK)
"""

import logging
import os
import platform
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Environment variable for user override
ENV_VAR_NAME = "CLAUDE_CODE_GIT_BASH_PATH"


@dataclass
class GitBashDetectionResult:
    """Result of git-bash detection attempt."""
    found: bool
    path: Optional[str] = None
    source: str = "not-found"
    message: str = ""


# Module-level cache (persists for process lifetime)
_cache: Optional[GitBashDetectionResult] = None


def _find_git_executable() -> Optional[str]:
    """
    Find git.exe using multiple methods.

    GUI apps on Windows often have different PATH than terminal sessions.
    We try multiple approaches to find git.

    Returns:
        Path to git.exe if found, None otherwise
    """
    import shutil
    import subprocess

    debug = os.environ.get("DEBUG", "").lower() in ("true", "1")

    # Method 1: shutil.which (standard PATH lookup)
    git_path = shutil.which("git")
    if git_path:
        if debug:
            print(f"[GitBash] Found git via shutil.which: {git_path}")
        return git_path

    # Method 2: Windows 'where' command (searches PATH differently)
    try:
        result = subprocess.run(
            ["where", "git"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        if result.returncode == 0 and result.stdout.strip():
            git_path = result.stdout.strip().split('\n')[0].strip()
            if os.path.isfile(git_path):
                if debug:
                    print(f"[GitBash] Found git via 'where' command: {git_path}")
                return git_path
    except Exception as e:
        if debug:
            print(f"[GitBash] 'where git' failed: {e}")

    # Method 3: Check Windows Registry for Git install location
    try:
        import winreg
        for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
            for key_path in [
                r"SOFTWARE\GitForWindows",
                r"SOFTWARE\WOW6432Node\GitForWindows",
            ]:
                try:
                    with winreg.OpenKey(hive, key_path) as key:
                        install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                        if install_path:
                            # Try multiple possible git.exe locations
                            for subpath in ["cmd\\git.exe", "bin\\git.exe", "mingw64\\bin\\git.exe"]:
                                git_exe = os.path.join(install_path, subpath)
                                if os.path.isfile(git_exe):
                                    if debug:
                                        print(f"[GitBash] Found git via registry: {git_exe}")
                                    return git_exe
                except (FileNotFoundError, OSError):
                    continue
    except ImportError:
        pass  # winreg not available (non-Windows)

    return None


def _find_bash_from_registry() -> Optional[str]:
    """
    Find bash.exe directly from Windows Registry Git InstallPath.

    This is more reliable than PATH-based detection for GUI apps.

    Returns:
        Path to bash.exe if found via registry, None otherwise
    """
    debug = os.environ.get("DEBUG", "").lower() in ("true", "1")

    try:
        import winreg
        for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
            for key_path in [
                r"SOFTWARE\GitForWindows",
                r"SOFTWARE\WOW6432Node\GitForWindows",
            ]:
                try:
                    with winreg.OpenKey(hive, key_path) as key:
                        install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                        if install_path:
                            # Check for bash.exe in standard locations
                            bash_exe = os.path.join(install_path, "bin", "bash.exe")
                            if os.path.isfile(bash_exe):
                                if debug:
                                    print(f"[GitBash] Found bash.exe via registry: {bash_exe}")
                                return bash_exe
                            # Try usr/bin as fallback
                            bash_exe = os.path.join(install_path, "usr", "bin", "bash.exe")
                            if os.path.isfile(bash_exe):
                                if debug:
                                    print(f"[GitBash] Found bash.exe via registry: {bash_exe}")
                                return bash_exe
                except (FileNotFoundError, OSError):
                    continue
    except ImportError:
        pass  # winreg not available (non-Windows)

    return None


def _derive_bash_from_git(git_path: str) -> Optional[str]:
    """
    Derive bash.exe location from git.exe path.

    Git for Windows structure:
      <install>/cmd/git.exe
      <install>/bin/bash.exe
      <install>/mingw64/bin/git.exe

    Args:
        git_path: Path to git.exe

    Returns:
        Path to bash.exe if found, None otherwise
    """
    git_dir = os.path.dirname(git_path)
    git_parent = os.path.dirname(git_dir)

    # Build list of possible bash locations
    possible_paths = []

    # If git is in cmd/ folder
    if git_dir.endswith("cmd"):
        possible_paths.extend([
            os.path.join(git_parent, "bin", "bash.exe"),
            os.path.join(git_parent, "usr", "bin", "bash.exe"),
        ])

    # If git is in mingw64/bin/ folder
    if "mingw64" in git_dir:
        git_root = git_parent
        while git_root and not git_root.endswith("mingw64"):
            git_root = os.path.dirname(git_root)
        if git_root:
            install_root = os.path.dirname(git_root)
            possible_paths.extend([
                os.path.join(install_root, "bin", "bash.exe"),
                os.path.join(install_root, "usr", "bin", "bash.exe"),
            ])

    # Generic fallbacks
    possible_paths.extend([
        os.path.join(git_parent, "bin", "bash.exe"),
        os.path.join(git_parent, "usr", "bin", "bash.exe"),
    ])

    for bash_path in possible_paths:
        if os.path.isfile(bash_path):
            return bash_path

    return None


def _find_git_from_path() -> Optional[str]:
    """
    Find bash.exe by first locating git.exe.

    Returns:
        Path to bash.exe if found via git location, None otherwise
    """
    git_path = _find_git_executable()
    if not git_path:
        return None

    return _derive_bash_from_git(git_path)


def _get_candidate_paths() -> list[str]:
    """
    Get list of candidate paths for bash.exe on Windows.

    Returns paths in priority order (most common first).
    """
    candidates = [
        # Standard 64-bit Git installation
        r"C:\Program Files\Git\bin\bash.exe",
        # Standard 32-bit Git installation
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        # User-specific installation (Git installer option)
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin\bash.exe"),
        # Chocolatey installation
        r"C:\ProgramData\chocolatey\lib\git\tools\bin\bash.exe",
        # Scoop installation
        os.path.expandvars(r"%USERPROFILE%\scoop\apps\git\current\bin\bash.exe"),
        # Git for Windows SDK
        r"C:\Git\bin\bash.exe",
        # Alternative usr/bin location (some Git versions)
        r"C:\Program Files\Git\usr\bin\bash.exe",
    ]
    return candidates


def detect_git_bash(force_refresh: bool = False) -> GitBashDetectionResult:
    """
    Detect git-bash installation on Windows.

    Args:
        force_refresh: If True, bypass cache and re-detect

    Returns:
        GitBashDetectionResult with detection outcome
    """
    global _cache

    # Non-Windows: not applicable
    if platform.system() != "Windows":
        return GitBashDetectionResult(
            found=False,
            source="not-applicable",
            message="Git Bash detection only applies to Windows"
        )

    # Return cached result if available
    if _cache is not None and not force_refresh:
        logger.debug(f"[GitBash] Using cached result: {_cache.path} ({_cache.source})")
        return _cache

    debug = os.environ.get("DEBUG", "").lower() in ("true", "1")
    if debug:
        print("[GitBash] Starting detection...")

    # Priority 1: Environment variable override
    env_path = os.environ.get(ENV_VAR_NAME)
    if env_path:
        if os.path.isfile(env_path):
            result = GitBashDetectionResult(
                found=True,
                path=env_path,
                source="env-var",
                message=f"Using {ENV_VAR_NAME}: {env_path}"
            )
            print(f"[GitBash] {result.message}")
            _cache = result
            return result
        else:
            print(f"[GitBash] WARNING: {ENV_VAR_NAME} set but path does not exist: {env_path}")

    # Priority 2: Windows Registry (most reliable for GUI apps)
    if debug:
        print("[GitBash] Checking Windows Registry...")

    registry_bash = _find_bash_from_registry()
    if registry_bash:
        result = GitBashDetectionResult(
            found=True,
            path=registry_bash,
            source="windows-registry",
            message=f"Found git-bash via registry: {registry_bash}"
        )
        print(f"[GitBash] {result.message}")
        _cache = result
        return result

    # Priority 3: Check standard candidate paths
    candidates = _get_candidate_paths()
    if debug:
        print(f"[GitBash] Checking {len(candidates)} standard paths...")

    for candidate_path in candidates:
        resolved = os.path.expandvars(candidate_path)
        if os.path.isfile(resolved):
            result = GitBashDetectionResult(
                found=True,
                path=resolved,
                source="standard-path",
                message=f"Found git-bash at standard path: {resolved}"
            )
            print(f"[GitBash] {result.message}")
            _cache = result
            return result
        elif debug:
            print(f"[GitBash] Not found: {resolved}")

    # Priority 4: Derive from git.exe in PATH (handles custom PATH setups)
    if debug:
        print("[GitBash] Checking PATH-based git installation...")

    path_based_bash = _find_git_from_path()
    if path_based_bash:
        result = GitBashDetectionResult(
            found=True,
            path=path_based_bash,
            source="derived-from-path",
            message=f"Found git-bash via PATH: {path_based_bash}"
        )
        print(f"[GitBash] {result.message}")
        _cache = result
        return result
    elif debug:
        print("[GitBash] Could not derive bash.exe from git PATH")

    # Not found
    result = GitBashDetectionResult(
        found=False,
        source="not-found",
        message=(
            "Git Bash not found. Install Git for Windows from https://git-scm.com/downloads/win "
            f"or set {ENV_VAR_NAME} environment variable."
        )
    )
    print(f"[GitBash] WARNING: {result.message}")
    _cache = result
    return result


def get_git_bash_path() -> Optional[str]:
    """
    Get the path to bash.exe if available.

    Convenience function that returns just the path or None.

    Returns:
        Path to bash.exe or None if not found
    """
    result = detect_git_bash()
    return result.path if result.found else None


def get_git_bash_env() -> dict[str, str]:
    """
    Get environment variables for Claude SDK with git-bash path.

    Returns a dict suitable for merging into SDK environment variables.
    Only returns the variable if git-bash was found.

    Returns:
        Dict with CLAUDE_CODE_GIT_BASH_PATH if found, empty dict otherwise
    """
    # Skip on non-Windows
    if platform.system() != "Windows":
        return {}

    result = detect_git_bash()
    if result.found and result.path:
        return {ENV_VAR_NAME: result.path}

    return {}


def clear_cache() -> None:
    """Clear the detection cache. Useful for testing."""
    global _cache
    _cache = None
    logger.debug("[GitBash] Cache cleared")


# Module-level cache for git executable path
_git_cache: Optional[str] = None


def get_git_executable_path() -> str:
    """
    Get the path to git executable.

    On Windows, uses multi-method detection (shutil.which, registry, standard paths).
    On other platforms, returns "git" and relies on PATH.

    Returns:
        Path to git executable, or "git" as fallback
    """
    global _git_cache

    # Return cached result if available
    if _git_cache is not None:
        return _git_cache

    # On non-Windows, just use "git" from PATH
    if platform.system() != "Windows":
        _git_cache = "git"
        return _git_cache

    # On Windows, try to find the full path
    git_path = _find_git_executable()
    if git_path:
        _git_cache = git_path
        debug = os.environ.get("DEBUG", "").lower() in ("true", "1")
        if debug:
            print(f"[Git] Using detected git: {git_path}")
        return _git_cache

    # Fallback to "git" and hope it's in PATH
    _git_cache = "git"
    return _git_cache
