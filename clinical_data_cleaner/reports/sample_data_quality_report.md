# Clinical Data Quality Report — Template

> Copy this structure for thesis / portfolio appendices, or let the agent
> generate a filled report automatically via `generate_report()` /
> `report_to_markdown()`.

---

**Source:** `[path/to/dataset.csv]`  
**Generated:** `[YYYY-MM-DD HH:MM:SS]`  
**Analyst:** `[Your name]`  
**Purpose:** `[e.g. Pre-analysis QC for ICU vitals cohort]`

## Executive Summary

| Metric | Value |
| --- | ---: |
| Rows |  |
| Columns |  |
| Columns with missing values |  |
| Clinical rule violations |  |
| Statistical outlier flags |  |
| Exact duplicate rows |  |
| Unit inconsistency flags |  |
| Date/time inconsistencies |  |
| Suggested cleaning actions |  |

**Overall judgement:** `[Fit for analysis / Needs cleaning / Not usable without remediation]`

## 1. Schema Profile

Dataset shape: **N** rows × **P** columns.

| Column | Inferred type | dtype | Missing | Min | Max | Mean |
| --- | --- | --- | ---: | ---: | ---: | ---: |
|  |  |  |  |  |  |  |

## 2. Missingness Summary

| Column | Missing (n) | Missing (%) | Decision |
| --- | ---: | ---: | --- |
|  |  |  | Keep / Impute / Drop |

## 3. Outlier Summary

| Column | Method | Outliers (n) | Details | Decision |
| --- | --- | ---: | --- | --- |
|  | IQR / z-score |  |  | Review / Cap / NA |

## 4. Clinical Rule Violations

Rules applied (edit as needed):

| Variable | Plausible range | Unit |
| --- | --- | --- |
| Age | 0–120 | years |
| Heart rate | 30–220 | bpm |
| Respiratory rate | 5–60 | /min |
| Temperature | 34–42 | °C |
| Sodium | 120–160 | mmol/L |
| Potassium | 2–7 | mmol/L |

| Column | Rule | Violations (n) | Example values |
| --- | --- | ---: | --- |
|  |  |  |  |

## 5. Duplicates

- Exact duplicate rows: **0**
- Duplicate IDs (`patient_id`): **0**

## 6. Unit Inconsistencies

| Column | Suspect unit | Target unit | n | Action |
| --- | --- | --- | ---: | --- |
| glucose | mg/dL | mmol/L |  | Convert |
| temperature | °F | °C |  | Convert |

## 7. Date/Time Inconsistencies

- Discharge before admission: **0** row(s)

## 8. Suggested Cleaning Actions

| ID | Priority | Category | Auto? | Description |
| --- | --- | --- | --- | --- |
| A01 | high | clinical_rule | yes | … |

## 9. Cleaning Decision Log

| Action ID | Applied? | Notes |
| --- | --- | --- |
| A01 | Yes / No |  |

## 10. Post-cleaning Status

- Cleaned rows:  
- Cleaned columns:  
- Remaining open issues:  

---

_Template for use with the Clinical Data Cleaner Agent_
