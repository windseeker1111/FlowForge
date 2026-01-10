# User Personas Feature - Implementation Plan

## Summary

Add a user persona generation and management system to Auto Claude that analyzes projects, generates relevant personas, allows user customization, and integrates personas into task creation, ideation, and agent prompts.

### User Decisions
- **Scope**: Project-scoped only (`.auto-claude/personas/`)
- **Roadmap Integration**: Standalone with optional sync from roadmap's target_audience
- **Research**: Optional web research phase (user chooses at generation time)
- **UI Location**: New sidebar nav item (like Roadmap)

---

## Phase 1: Backend - Persona Generation Pipeline

### New Files to Create

```
apps/backend/runners/persona_runner.py          # CLI entry point
apps/backend/runners/personas/
├── __init__.py
├── orchestrator.py                             # PersonaOrchestrator class
├── phases.py                                   # DiscoveryPhase, ResearchPhase, GenerationPhase
├── models.py                                   # PersonaPhaseResult dataclass
└── graph_integration.py                        # Graphiti context retrieval

apps/backend/prompts/
├── persona_discovery.md                        # Phase 1: Analyze project for user types
├── persona_generation.md                       # Phase 3: Generate detailed personas
└── persona_research.md                         # Phase 2 (optional): Web research enrichment
```

### Pipeline Architecture

```
Phase 1: Discovery          Phase 2: Research (optional)     Phase 3: Generation
┌──────────────────┐       ┌──────────────────────┐       ┌──────────────────┐
│ Analyze project  │       │ Web search for       │       │ Generate detailed│
│ structure, docs, │──────▶│ industry insights,   │──────▶│ persona profiles │
│ roadmap context  │       │ user feedback        │       │ with goals/pains │
└──────────────────┘       └──────────────────────┘       └──────────────────┘
        │                           │                              │
        ▼                           ▼                              ▼
persona_discovery.json      research_results.json           personas.json
```

### Key Pattern to Follow

Reference: `apps/backend/runners/roadmap/orchestrator.py`

```python
class PersonaOrchestrator:
    def __init__(
        self,
        project_dir: Path,
        output_dir: Path | None = None,
        model: str = "sonnet",
        thinking_level: str = "medium",
        refresh: bool = False,
        enable_research: bool = False,  # NEW: optional research phase
    ):
        # Initialize output to .auto-claude/personas/
        # Initialize phase handlers: DiscoveryPhase, ResearchPhase, GenerationPhase
        # Initialize executors: ScriptExecutor, AgentExecutor

    async def run(self) -> bool:
        # Phase 1: Discovery (required)
        # Phase 2: Research (optional, graceful degradation)
        # Phase 3: Generation (required)
```

### Data Storage

```
.auto-claude/personas/
├── persona_discovery.json    # Identified user types + roadmap sync
├── research_results.json     # Web research enrichment (optional)
└── personas.json             # Final persona profiles
```

---

## Phase 2: Persona Data Schema

### TypeScript Types

Create: `apps/frontend/src/shared/types/persona.ts`

```typescript
export interface Persona {
  id: string;
  name: string;                    // e.g., "Alex the API Developer"
  type: 'primary' | 'secondary' | 'edge-case';
  tagline: string;

  avatar: {
    initials: string;
    color: string;                 // Hex color for display
  };

  demographics: {
    role: string;                  // Job title
    experienceLevel: 'junior' | 'mid' | 'senior' | 'lead' | 'executive';
    industry?: string;
    companySize?: 'startup' | 'small' | 'medium' | 'enterprise';
  };

  goals: Array<{
    id: string;
    description: string;
    priority: 'must-have' | 'should-have' | 'nice-to-have';
  }>;

  painPoints: Array<{
    id: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
    currentWorkaround?: string;
  }>;

  behaviors: {
    usageFrequency: 'daily' | 'weekly' | 'monthly' | 'occasionally';
    preferredChannels: string[];   // CLI, API, Dashboard, etc.
    decisionFactors: string[];
    toolStack: string[];
  };

  quotes: string[];                // Realistic quotes this persona might say

  scenarios: Array<{
    id: string;
    title: string;
    context: string;
    action: string;
    outcome: string;
  }>;

  featurePreferences: {
    mustHave: string[];
    niceToHave: string[];
    avoid: string[];
  };

  discoverySource: {
    userTypeId: string;
    confidence: 'high' | 'medium' | 'low';
    researchEnriched: boolean;
  };

  createdAt: string;
  updatedAt: string;
}

export interface PersonasConfig {
  version: '1.0';
  projectId: string;
  personas: Persona[];
  metadata: {
    generatedAt: string;
    discoverySynced: boolean;
    researchEnriched: boolean;
    roadmapSynced: boolean;
    personaCount: number;
  };
}

export interface PersonaGenerationStatus {
  phase: 'idle' | 'analyzing' | 'discovering' | 'researching' | 'generating' | 'complete' | 'error';
  progress: number;          // 0-100
  message: string;
  error?: string;
}
```

---

## Phase 3: Frontend - IPC & State Management

### IPC Channels

Add to: `apps/frontend/src/shared/constants/ipc.ts`

```typescript
// Persona operations
PERSONA_GET: 'persona:get',
PERSONA_GENERATE: 'persona:generate',
PERSONA_REFRESH: 'persona:refresh',
PERSONA_STOP: 'persona:stop',
PERSONA_SAVE: 'persona:save',
PERSONA_UPDATE: 'persona:update',
PERSONA_DELETE: 'persona:delete',
PERSONA_ADD: 'persona:add',

// Persona events (main -> renderer)
PERSONA_PROGRESS: 'persona:progress',
PERSONA_COMPLETE: 'persona:complete',
PERSONA_ERROR: 'persona:error',
PERSONA_STOPPED: 'persona:stopped',
```

### Preload API

Create: `apps/frontend/src/preload/api/modules/persona-api.ts`

```typescript
export interface PersonaAPI {
  getPersonas(projectId: string): Promise<PersonasConfig | null>;
  generatePersonas(projectId: string, options: { enableResearch: boolean }): void;
  refreshPersonas(projectId: string): void;
  stopPersonas(projectId: string): void;
  savePersonas(projectId: string, personas: Persona[]): Promise<void>;
  updatePersona(projectId: string, personaId: string, updates: Partial<Persona>): Promise<void>;
  deletePersona(projectId: string, personaId: string): Promise<void>;
  addPersona(projectId: string, persona: Persona): Promise<void>;

  // Event listeners
  onPersonaProgress(callback: (projectId: string, status: PersonaGenerationStatus) => void): () => void;
  onPersonaComplete(callback: (projectId: string) => void): () => void;
  onPersonaError(callback: (projectId: string, error: string) => void): () => void;
}
```

### Zustand Store

Create: `apps/frontend/src/renderer/stores/persona-store.ts`

Follow pattern from: `apps/frontend/src/renderer/stores/roadmap-store.ts`

---

## Phase 4: Frontend - UI Components

### Component Structure

```
apps/frontend/src/renderer/components/
├── Personas.tsx                         # Main page (pattern: Roadmap.tsx)
└── personas/
    ├── PersonaEmptyState.tsx            # No personas CTA
    ├── PersonaGenerationProgress.tsx    # Progress UI during generation
    ├── PersonaHeader.tsx                # Title + actions bar
    ├── PersonaList.tsx                  # Grid of persona cards
    ├── PersonaCard.tsx                  # Individual card
    ├── PersonaDetailPanel.tsx           # Slide-out detail view
    ├── PersonaEditDialog.tsx            # Add/edit dialog
    └── hooks/
        ├── usePersonaData.ts
        ├── usePersonaGeneration.ts
        └── usePersonaActions.ts
```

### Navigation

Add to Sidebar: `apps/frontend/src/renderer/components/Sidebar.tsx`

```typescript
{ id: 'personas', labelKey: 'navigation:items.personas', icon: Users, shortcut: 'U' }
```

### i18n Translations

Add files:
- `apps/frontend/src/shared/i18n/locales/en/personas.json`
- `apps/frontend/src/shared/i18n/locales/fr/personas.json`

Update:
- `apps/frontend/src/shared/i18n/locales/en/navigation.json` - add `"personas": "User Personas"`
- `apps/frontend/src/shared/i18n/locales/fr/navigation.json` - add `"personas": "Personas Utilisateurs"`

---

## Phase 5: Integration Points

### 5.1 Task Metadata Integration

Modify: `apps/frontend/src/shared/types/task.ts`

```typescript
export interface TaskMetadata {
  // ... existing fields

  // NEW: Persona associations
  targetPersonaIds?: string[];
  personaAlignment?: Array<{
    personaId: string;
    goalIds?: string[];       // Which goals this addresses
    painPointIds?: string[];  // Which pain points this solves
  }>;
}
```

### 5.2 Ideation Integration

Modify: `apps/backend/ideation/analyzer.py`

Inject personas into `ideation_context.json`:

```python
def gather_context(project_dir: Path) -> dict:
    context = { ... existing ... }

    # Load personas if available
    personas_path = project_dir / ".auto-claude" / "personas" / "personas.json"
    if personas_path.exists():
        with open(personas_path) as f:
            personas_data = json.load(f)
            context["personas"] = [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "goals": [g["description"] for g in p["goals"]],
                    "pain_points": [pp["description"] for pp in p["pain_points"]]
                }
                for p in personas_data.get("personas", [])
            ]
    return context
```

### 5.3 Agent Prompt Integration

Add persona context section to:
- `apps/backend/prompts/planner.md`
- `apps/backend/prompts/coder.md`
- `apps/backend/prompts/qa_reviewer.md`

```markdown
## PERSONA CONTEXT (if available)

Check for personas:
```bash
cat .auto-claude/personas/personas.json 2>/dev/null | jq '.personas[] | {name, goals: .goals[].description, painPoints: .painPoints[].description}' || echo "No personas"
```

If personas exist, consider:
- Which persona is this feature primarily for?
- Do UX decisions favor this persona's preferences?
- Do error messages match the persona's expertise level?
```

---

## Implementation Order

1. **Backend Prompts** - Create the three prompt files
2. **Backend Pipeline** - Create persona_runner.py and personas/ module
3. **Types** - Create persona.ts with all TypeScript interfaces
4. **IPC Layer** - Add channels, preload API, handlers
5. **Store** - Create persona-store.ts
6. **UI Components** - Build component hierarchy
7. **Navigation** - Add sidebar item and routing
8. **i18n** - Add all translation files
9. **Ideation Integration** - Inject personas into context
10. **Task Integration** - Extend TaskMetadata
11. **Agent Prompts** - Add persona context sections

---

## Verification Plan

### Unit Tests
- Backend: Test persona generation pipeline phases
- Frontend: Test persona store actions and selectors

### Integration Tests
- Test persona flow: generate → edit → save → reload
- Test ideation with persona context injection
- Test task creation with persona tagging

### E2E Tests (Electron MCP)
- Navigate to Personas page
- Generate personas (mock or real)
- Verify persona cards render
- Test edit/add dialogs
- Verify persistence after reload

### Manual Testing
1. Generate personas for a sample project
2. Verify roadmap sync works (if roadmap exists)
3. Enable research and verify enrichment
4. Create task, tag with persona
5. Run ideation, verify persona context in ideas
6. Start a build, verify persona context in agent logs

---

## Key Reference Files

| Purpose | File Path |
|---------|-----------|
| Backend orchestrator pattern | `apps/backend/runners/roadmap/orchestrator.py` |
| Backend prompt pattern | `apps/backend/prompts/roadmap_discovery.md` |
| Frontend types pattern | `apps/frontend/src/shared/types/roadmap.ts` |
| Zustand store pattern | `apps/frontend/src/renderer/stores/roadmap-store.ts` |
| IPC handler pattern | `apps/frontend/src/main/ipc-handlers/roadmap-handlers.ts` |
| Preload API pattern | `apps/frontend/src/preload/api/modules/roadmap-api.ts` |
| Component pattern | `apps/frontend/src/renderer/components/Roadmap.tsx` |

---

## Ralph Loop Implementation Guide

### What is Ralph Loop?

Ralph Loop is an iterative development methodology where the same prompt is fed to Claude repeatedly. Claude sees its previous work in files and git history, iteratively improving until completion. It's "deterministically bad in an undeterministic world" - failures are predictable, enabling systematic improvement.

### How to Use This Plan with Ralph Loop

Run the Ralph Loop with:

```bash
/ralph-loop "Implement the User Personas feature following docs/user-personas-plan.md" --max-iterations 50 --completion-promise "PERSONAS FEATURE COMPLETE"
```

### Iteration Sequence

Each iteration, Claude should:

1. **Read the plan** - `cat docs/user-personas-plan.md`
2. **Check current progress** - Review git status and existing files
3. **Identify next incomplete step** from the Implementation Order
4. **Implement that step** following the patterns in Key Reference Files
5. **Verify the step** - Run tests, check types, verify file creation
6. **Commit progress** - `git add . && git commit -m "feat(personas): [step description]"`
7. **Repeat** until all steps complete

### Step-by-Step Iteration Goals

| Iteration | Goal | Verification |
|-----------|------|--------------|
| 1-3 | Create backend prompts (persona_discovery.md, persona_generation.md, persona_research.md) | Files exist in `apps/backend/prompts/` |
| 4-8 | Create backend pipeline (persona_runner.py, orchestrator.py, phases.py, models.py) | `python persona_runner.py --help` works |
| 9-10 | Create TypeScript types (persona.ts) | `npm run typecheck` passes |
| 11-14 | Add IPC channels and handlers | IPC constants added, handlers registered |
| 15-17 | Create Zustand store (persona-store.ts) | Store exports work, no type errors |
| 18-25 | Build UI components | Components render without errors |
| 26-28 | Add navigation and i18n | Sidebar shows Personas item |
| 29-32 | Ideation integration | Personas appear in ideation context |
| 33-35 | Task metadata integration | Tasks can be tagged with personas |
| 36-40 | Agent prompt integration | Agents read persona context |
| 41-45 | Testing and bug fixes | All tests pass |
| 46-50 | Final polish and documentation | Feature fully functional |

### Completion Criteria

The feature is complete when ALL of the following are true:

1. **Backend Pipeline**
   - [ ] `apps/backend/prompts/persona_discovery.md` exists and follows prompt patterns
   - [ ] `apps/backend/prompts/persona_generation.md` exists and follows prompt patterns
   - [ ] `apps/backend/prompts/persona_research.md` exists and follows prompt patterns
   - [ ] `apps/backend/runners/persona_runner.py` executes without errors
   - [ ] `apps/backend/runners/personas/orchestrator.py` follows RoadmapOrchestrator pattern
   - [ ] Persona generation creates valid `personas.json` in `.auto-claude/personas/`

2. **Frontend Types & State**
   - [ ] `apps/frontend/src/shared/types/persona.ts` defines all interfaces
   - [ ] `apps/frontend/src/shared/constants/ipc.ts` includes PERSONA_* channels
   - [ ] `apps/frontend/src/renderer/stores/persona-store.ts` manages state
   - [ ] `npm run typecheck` passes with no errors

3. **Frontend UI**
   - [ ] `apps/frontend/src/renderer/components/Personas.tsx` renders
   - [ ] PersonaCard, PersonaList, PersonaDetailPanel components work
   - [ ] PersonaEditDialog allows adding/editing personas
   - [ ] Personas appears in sidebar navigation
   - [ ] i18n translations exist for en and fr

4. **Integrations**
   - [ ] Ideation injects personas into context when available
   - [ ] TaskMetadata supports targetPersonaIds field
   - [ ] Agent prompts include persona context section

5. **Quality**
   - [ ] `npm run lint` passes
   - [ ] `npm run typecheck` passes
   - [ ] `npm test` passes (frontend)
   - [ ] `npm run test:backend` passes
   - [ ] No console errors when running the app

### Completion Promise

When all criteria are met, output:

```
<promise>PERSONAS FEATURE COMPLETE</promise>
```

This signals the Ralph Loop to stop iterating.
