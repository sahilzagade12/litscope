#!/usr/bin/env python3
"""
Demonstration: Clinical Data Cleaner Agent on a mock hospital dataset.

Run from the clinical_data_cleaner directory:

    python demo.py

Or from the repo root:

    python -m clinical_data_cleaner.demo
"""

from __future__ import annotations

from pathlib import Path

from agent import ClinicalRule, clean_data


def main() -> None:
    base = Path(__file__).resolve().parent
    source = base / "data" / "mock_patients.csv"
    output_dir = base / "output"

    print("=" * 64)
    print(" Clinical Data Cleaner Agent — Demonstration")
    print("=" * 64)
    print(f"\nInput : {source}")
    print(f"Mode  : clean (report + cleaned dataset)")
    print(f"Output: {output_dir}\n")

    # Optional custom rule example (e.g. ward-specific SpO2 floor)
    custom = [
        ClinicalRule(
            column="spo2",
            min_value=70,
            max_value=100,
            unit="%",
            description="Custom SpO2 floor for this cohort",
        )
    ]

    result = clean_data(
        source,
        mode="clean",
        output_dir=output_dir,
        custom_rules=custom,
        outlier_method="iqr",
        id_columns=["patient_id"],
    )

    print(result["markdown"])
    print("-" * 64)
    print("Artefacts written:")
    print(f"  Report (Markdown): {result['report_md_path']}")
    print(f"  Report (JSON)    : {result['report_json_path']}")
    print(f"  Cleaned CSV      : {result['cleaned_csv_path']}")
    print(f"  Cleaning log     : {result['cleaning_log_path']}")
    print("\nCleaning log:")
    for line in result["cleaning_log"]:
        print(f"  • {line}")

    cleaned = result["cleaned_df"]
    n_before = result["report"].summary["rows"]
    print(f"\nRows before → after: {n_before} → {len(cleaned)}")
    print("Demo complete.")


if __name__ == "__main__":
    main()
