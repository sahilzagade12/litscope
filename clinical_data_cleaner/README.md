# Clinical Data Cleaner Agent

A modular Python agent for profiling, validating, and cleaning clinical / health datasets. Built for Master of Health Data Analytics coursework and portfolio use.

## What it does

1. **Ingest** CSV, Excel, TSV, Parquet, or SQL-extracted tables  
2. **Profile** schema — types, ranges, missingness  
3. **Detect** missing values, outliers, clinical rule violations, unit issues, date errors, duplicates  
4. **Report** a structured, thesis-ready Data Quality Report (Markdown + JSON)  
5. **Clean** optionally apply an automated cleaning plan, or leave a plan-only report  

## Quick start

```bash
cd clinical_data_cleaner
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Full demonstration on the mock dataset (recommended first run)
python demo.py
```

From the **repository root**:

```bash
# Plan only (report, no cleaned file)
python -m clinical_data_cleaner clinical_data_cleaner/data/mock_patients.csv --mode plan

# Clean + report
python -m clinical_data_cleaner clinical_data_cleaner/data/mock_patients.csv --mode clean --output-dir clinical_data_cleaner/output
```

## Python API

```python
from clinical_data_cleaner import clean_data, ClinicalRule

# Report + cleaning plan only
result = clean_data("patients.csv", mode="plan")

# Report + cleaned dataset
result = clean_data("patients.csv", mode="clean", output_dir="output")

print(result["markdown"])          # human-readable report
print(result["cleaning_log"])      # steps applied
df_clean = result["cleaned_df"]    # pandas DataFrame
```

### Custom clinical rules

```python
from clinical_data_cleaner import ClinicalRule, clean_data

custom = [
    ClinicalRule("lactate", 0.5, 20.0, unit="mmol/L", description="Serum lactate"),
]
clean_data("labs.csv", mode="plan", custom_rules=custom)
```

## Modules

| Function | Role |
| --- | --- |
| `load_data()` | CSV / Excel / SQL / DataFrame ingest |
| `profile_schema()` | Column types, ranges, stats |
| `detect_missingness()` | Missingness summary |
| `detect_outliers()` | IQR or z-score outliers |
| `clinical_rules_check()` | Plausibility ranges + custom rules |
| `generate_report()` | Full structured report object |
| `apply_cleaning_plan()` | Apply automated cleaning steps |
| `clean_data()` | End-to-end CLI / function entry point |

## Default clinical rules

| Variable | Range | Unit |
| --- | --- | --- |
| Age | 0–120 | years |
| Heart rate | 30–220 | bpm |
| Respiratory rate | 5–60 | /min |
| Temperature | 34–42 | °C |
| Sodium | 120–160 | mmol/L |
| Potassium | 2–7 | mmol/L |
| (+ SBP, DBP, SpO₂, glucose, creatinine, BMI) | | |

## Project layout

```
clinical_data_cleaner/
├── agent.py                          # Full agent implementation
├── demo.py                           # Mock-dataset demonstration
├── requirements.txt
├── data/mock_patients.csv            # Intentionally messy demo data
├── reports/sample_data_quality_report.md
└── output/                           # Generated reports & cleaned files
```

## Mock dataset issues (for demo)

The included `mock_patients.csv` deliberately contains:

- Negative / impossible ages  
- Heart rate = 0 and extreme tachycardia  
- Temperature in °F mixed with °C  
- Glucose / creatinine in mg/dL mixed with SI units  
- Discharge date before admission  
- Exact duplicate rows  
- Missing sex, potassium, blood pressure, BMI  

## Report template

See [`reports/sample_data_quality_report.md`](reports/sample_data_quality_report.md) for a blank thesis/portfolio template matching the agent output sections.
