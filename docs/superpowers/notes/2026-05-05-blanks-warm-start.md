# Blanks Feature — Warm-Start Notes (paused 2026-05-05)

**Status:** Paused awaiting Martha's input on her blank-correction workflow. The
"trivial half" (loading + integrating a blank file) needs no code — the
existing app handles it. The "real" half (pairing blank cycles to sample cycles
and applying subtraction) is gated on workflow details only Martha can give us.

When you resume, **start by reading this file end-to-end before brainstorming.**

---

## What's already verified

- A blank run produces reactor + IR + oxygen files structurally identical to a
  sample run.
- `load_experiment()` + `build_full_cycles()` work cleanly on
  `250929_Blanks/` (untracked; data only on local disk):
  - **21 cycles detected**, all with full capture / purge / hydrogenation
    windows, in both ZA and CZA modes.
  - Reactor signals all present; `5#10%CO2 RSP` is the active CO2 MFC.
  - The auto-detect logic added in commit `1603b5f` correctly picks it up.
- Martha's curated reference workbook
  `250929_Blanks/251015_blanks_ZA_Cond1-4.xlsx` (a different, older blank run —
  reactor source `241003_Data_All`, 11 cycles) is itself just a regular
  `Effi run log` / `data all` / `Quantification` workbook. **No subtraction
  happens inside it.** It is a per-blank-file integration that Martha hand-types
  into a sample workbook's `corrected sheet_Anh` column 12.

**Implication:** today, a user can already get the per-cycle, per-species %·s
blank values they need by loading the blank exactly like a sample. The README
now documents this (`## Analyzing a Blank Run` section).

## Why we paused

Building anything beyond "load and read" requires guessing at workflow choices
that drive design. Best-guess assumptions risk a redesign once Martha confirms
or contradicts. Three concrete unknowns each have substantial design
consequences:

1. **Pairing rule.** In `251015_blanks_ZA_Cond1-4.xlsx` Martha groups blank
   cycles by feed condition (`Cond1` = blank cycles 1–2, `Cond2` = 3–5, `Cond3`
   = 6–8, `Cond4` = 9–11). In `corrected sheet_Anh` for K-ZA she uses a single
   constant blank value for cycles 16–20 and per-cycle values for 1–15.
   Pairing is therefore neither strictly cycle-index nor strictly per-condition
   — it depends on how she sets the run up that day.
2. **Reuse across experiments.** A single blank run (`241003`) was reused as the
   reference for a different sample experiment (`250929`-era K-ZA). So a
   blank-correction feature probably needs blank persistence across sessions,
   not just same-session pairing.
3. **Averaging vs per-cycle.** When she has multiple blank cycles for one
   condition, does she always average them before subtracting, or sometimes use
   the per-cycle value? `251015_blanks_ZA_Cond1-4.xlsx` shows she computes both
   (`Ave.` rows 24, 27, 30, 33), but it's unclear which she ends up using.

## Open questions for Martha

When you next talk to her, ask in roughly this order:

1. Walk me through how you decide which blank value goes into column 12 of
   `corrected sheet_Anh`. (Single per-cycle? Average over a condition?
   Constant?)
2. How do you define a "condition" — is it always feed flowrate × feed CO2
   fraction, or do other knobs change it?
3. When sample cycles span more conditions than the blank covers, what do you
   do?
4. Do you ever recompute blanks for a sample run, or always reuse a previous
   blank run? If reuse, how do you pick which blank file to use?
5. Which species need correction? (`corrected sheet_Anh` corrects CO2, CO,
   MeOH, Methane, DME — anything else?)
6. Is the column-21/22 atm-side "blank" always the same as the column-12 HP-
   side blank for a given cycle/condition, or do you compute them separately?
7. Are there ever sample cycles for which you intentionally don't subtract?

## When Martha replies — resume protocol

1. Re-read this file and the relevant section of
   `docs/superpowers/plans/2026-04-14-rcc-cycle-steps.md` (see
   `:1356`-area for the original blanks dev note).
2. Re-load the brainstorming skill (the HARD-GATE in that workflow prevents
   coding before a written design exists).
3. Translate her answers into design decisions, then write the design doc to
   `docs/superpowers/specs/YYYY-MM-DD-blanks-design.md`.
4. Get user approval on the design.
5. Write the implementation plan to `docs/superpowers/plans/`.
6. Implement.

## Pointers (where to look first)

- `backend/effi/api.py` — `AppState` is the natural place to add a second
  ("blank") slot. `LoadRequest` is where a "this is a blank" flag could attach.
- `backend/effi/models.py` — `Cycle` is mutable; a `blank_integrals: dict |
  None` field on `Cycle` (or a parallel structure keyed by cycle id) is one
  shape worth considering, but don't lock it in until pairing rules are known.
- `backend/effi/integration.py` — `integrate_species()` returns a dict of
  `%·s`. Subtraction is just dict-arithmetic at the call site; the algorithm is
  trivial. The hard part is wiring + pairing.
- `frontend/src/components/FileSelector.tsx` — likely host for any
  "load blank alongside" UI.
- `251013_K-ZA_Cycles 1-20_good/251014_K-ZA_Cycle1-20_Results_Anh.xlsx` sheet
  `corrected sheet_Anh` is the canonical reference for what subtraction
  produces. Block layout: CO row 8, MeOH row 31 (K-ZA) / 47 (flue-CZA), Methane
  row 54, DME row 77 (K-ZA only). Each block: col 11 = cycle, 12 = blank, 13 =
  sample HP, 21 = blank atm, 22 = sample atm.
- `260121_CZA-flueCO2/260121_10Na-CZA_NOx+SOx_Results_Anh.xlsx` is the
  flue-CZA equivalent.
- µmol/g conversion (Martha): `(%·s) × (flowrate_scc_per_s / 100 / 1000) ×
  (PV/RT at STP) / catalyst_mass_g × 1e6`; P=760 torr, R=62.36 L·mmHg/(K·mol),
  T=273.15 K, K-ZA mass=0.5 g.

## Validation snapshot from last session

(Summarized from earlier work — useful when reasoning about whether a future
blank-corrected number is right.)

- K-ZA CO2 capture: cycles 16–20 match Martha exactly (10⁻⁴ %·s).
- K-ZA cycles 1–15 disagree with Martha because she manually shortened the
  integration windows on those — not a bug.
- flue-CZA MeOH: 35/36 cycles within ±0.3 %·s. Cycle 17 is a confirmed reactor
  blip (ATM duration 18468s vs ~7176s normal). Cycle 24 outlier is likely
  another Martha manual trim.
- Sub-sample-point HP/ATM boundary shift exists vs Martha's split, but total
  integration is conserved.

## Recent commits relevant to blanks

- `1603b5f` fix: detect captures across all experiments + correct cycle
  numbering (auto-CO2-MFC detection — ensures blank file with `5#10%CO2 RSP`
  detects cycles correctly)

## Don'ts

- Do not invent a pairing UI before Martha confirms the rule. The shape of the
  rule will dictate the shape of the UI.
- Do not assume the same blank value applies to all atm + HP in a cycle. Martha
  records them in separate columns; treat them as separable until told
  otherwise.
- Do not commit any blank data files. `250929_Blanks/` is now in `.gitignore`.
