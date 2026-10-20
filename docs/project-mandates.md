# Budgeted cloud research — first release

The project overview contains a collapsed **Milestone & project budget** panel. The owner confirms a goal, observable acceptance criteria, deadline, stop conditions, allowed research tools and per-model token caps. Saving pauses all project scopes. Resuming is explicit and starts only the currently selected question; other paused scopes remain paused. Stopped/accepted milestones require a new confirmed revision.

## Scope

- Caps cover cloud research across **all questions, branches and roles** under the authenticated owner/project pair. Each shared model has its own lifetime, UTC daily and per-call reservation caps.
- Caps are spending ceilings over existing account credits, **not a token purchase, reserved allocation, cash wallet or prepaid balance**. Other projects/chat can still consume the same account credits. The smaller applicable account, project or platform limit wins.
- Accounting begins at first enrollment. Earlier usage is not retroactively included. Changing/removing model budgets or creating a new milestone never resets project spending. Historical model consumption remains visible.
- Existing projects retain their previous account/daily-call controls until explicitly enrolled. No automatic migration, initial allocation, payment or top-up.
- Budget mode supports platform shared models. Existing BYOK bindings are rejected at preflight/dispatch once enrolled. Manual browser chat is outside the cloud project cap; browser research teams are disabled for enrolled projects to avoid implying they are covered.
- Tools: material analysis and optionally Crossref metadata collection. No purchase, outreach, terminal or device execution permission is created. Qualitative stop conditions are interpreted by the manager, while deadlines/permissions/budget gates are enforced by the server. Completion requires the authenticated user's acceptance note.

## Enforcement and accounting

Project agreements live in the existing encrypted shared-model ledger. Its single-process serialized transaction reserves account credits and checks project caps together. Existing call records act as the reservation/settlement/release ledger and carry project/branch/role/run and mandate revision. Revisions and owner actions retain history. API inputs cannot choose another owner.

Reservations use the existing conservative input estimate plus output limit. They are not guaranteed supplier currency charges or an exact tokenizer. Provider-reported usage settles actual tokens; a response reporting more than reserved disables that shared model under the existing overrun mechanism. Unknown usage retains the hold and blocks **all models in that project** until an administrator reconciles with a provider receipt. Restarted outstanding reservations become uncertain. Idempotent request IDs prevent repeated dispatch.

## Checkpoints

Budget or permission rejection before dispatch and explicit pause can preserve completed steps. Each step has a persisted attempt ID and request fingerprint. Resume reuses completed outputs without another model call, and preflights the **next unpaid role's model**. Budget-only changes preserve checkpoint terms. Changes to the goal, acceptance, stop conditions, deadline, permissions or synchronized context require discarding the old checkpoint before re-planning. Discard keeps prior results and charges.

A lost/in-flight/uncertain result is not safe to replay. Restart recovery still blocks for review; this is not arbitrary crash-resume of paid actions. New evidence arriving in the inbox is processed in subsequent batches; evidence/context changes invalidate the old checkpoint. This is not yet full transitive evidence invalidation of all historical summaries/artifacts.

## API and rollout

All endpoints use the existing authenticated scope query (`projectId`, `branchId`, `scopeId`):

- `GET /state`: adds `mandate` (null before enrollment), usage, recent project calls, effective status.
- `PUT /mandate`: `{expectedRevision, confirmed:true, goal, acceptance, stopCondition, deadline, tools, budgets}`. Budget entries: `{totalTokens,dailyTokens,perCallTokens}`. Saves a paused revision.
- `POST /mandate/action`: `{expectedRevision,action:"resume"|"pause"|"stop"|"complete",note?}`. Complete requires a note. Resume authorizes; the existing `/policy` enables the selected scope after preflight.
- `POST /checkpoint/discard`: paused/non-running scope only.
- `/health` advertises `capabilities.projectMandates`.

Deploy backend before frontend; preserve encrypted data volume and master key. This change does not modify billing, prices or iOS signing. **Do not roll an enrolled production backend back to code without mandate enforcement while research is enabled**; pause affected scopes first. No schema deletion is required.

## Validation

`npm run test:budget` uses temporary local storage and fake providers, with no real spending. Coverage: cross-branch caps, concurrent holds, duplicate IDs, uncertain settlement/restart, owner isolation, deadline and permission gates, pause before dispatch/refund, checkpoint replay, changed evidence, budget-only revisions, idle checks, BYOK rejection, and next-role preflight. Existing wake/shared/heartbeat/overview tests provide regression coverage.

`/__test__/project-budget.html` is a development-only interactive fixture. It displays simulated project data and does not update production budgets. It is not built into the production site.
