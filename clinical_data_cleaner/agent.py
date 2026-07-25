#!/usr/bin/env python3
"""
Clinical Data Cleaner Agent
===========================
A modular data-quality agent for health datasets (CSV, Excel, SQL tables).

Designed for Master of Health Data Analytics coursework and portfolio use.

Modules
-------
- load_data()
- profile_schema()
- detect_missingness()
- detect_outliers()
- clinical_rules_check()
- generate_report()
- apply_cleaning_plan()
- clean_data()  — high-level entry point / CLI

Usage
-----
    from clinical_data_cleaner import clean_data
    result = clean_data("patients.csv", mode="plan")   # report + plan only
    result = clean_data("patients.csv", mode="clean")  # report + cleaned CSV

    python -m clinical_data_cleaner data/mock_patients.csv --mode clean
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Clinical validation rules library
# ---------------------------------------------------------------------------

@dataclass
class ClinicalRule:
    """A numeric clinical plausibility range for a column."""

    column: str
    min_value: float
    max_value: float
    unit: str = ""
    description: str = ""

    def label(self) -> str:
        unit = f" {self.unit}" if self.unit else ""
        return f"{self.column}: {self.min_value}–{self.max_value}{unit}"


# Default rules (common vital signs and electrolytes)
DEFAULT_CLINICAL_RULES: list[ClinicalRule] = [
    ClinicalRule("age", 0, 120, "years", "Chronological age"),
    ClinicalRule("heart_rate", 30, 220, "bpm", "Heart rate"),
    ClinicalRule("respiratory_rate", 5, 60, "/min", "Respiratory rate"),
    ClinicalRule("temperature", 34, 42, "°C", "Body temperature"),
    ClinicalRule("systolic_bp", 50, 250, "mmHg", "Systolic blood pressure"),
    ClinicalRule("diastolic_bp", 30, 150, "mmHg", "Diastolic blood pressure"),
    ClinicalRule("spo2", 50, 100, "%", "Oxygen saturation"),
    ClinicalRule("sodium", 120, 160, "mmol/L", "Serum sodium"),
    ClinicalRule("potassium", 2.0, 7.0, "mmol/L", "Serum potassium"),
    ClinicalRule("glucose", 1.0, 40.0, "mmol/L", "Blood glucose (SI)"),
    ClinicalRule("creatinine", 20, 1500, "µmol/L", "Serum creatinine (SI)"),
    ClinicalRule("bmi", 10, 80, "kg/m²", "Body mass index"),
]

# Column-name aliases so rules match common naming variants
COLUMN_ALIASES: dict[str, list[str]] = {
    "age": ["age", "age_years", "patient_age"],
    "heart_rate": ["heart_rate", "hr", "pulse", "pulse_rate"],
    "respiratory_rate": ["respiratory_rate", "rr", "resp_rate"],
    "temperature": ["temperature", "temp", "temp_c", "body_temp"],
    "systolic_bp": ["systolic_bp", "sbp", "sys_bp", "bp_systolic"],
    "diastolic_bp": ["diastolic_bp", "dbp", "dia_bp", "bp_diastolic"],
    "spo2": ["spo2", "oxygen_sat", "o2_sat", "sao2"],
    "sodium": ["sodium", "na", "serum_na", "na_mmol"],
    "potassium": ["potassium", "k", "serum_k", "k_mmol"],
    "glucose": ["glucose", "blood_glucose", "bg", "glucose_mmol"],
    "creatinine": ["creatinine", "creat", "serum_creatinine"],
    "bmi": ["bmi", "body_mass_index"],
}

# Unit conversion helpers (value assumed in "from" unit → SI/"to" unit)
UNIT_CONVERSIONS: dict[str, dict[str, Any]] = {
    "glucose": {
        "from_unit": "mg/dL",
        "to_unit": "mmol/L",
        "factor": 1 / 18.0182,
        "detect_threshold": 50,  # values above this likely mg/dL
    },
    "creatinine": {
        "from_unit": "mg/dL",
        "to_unit": "µmol/L",
        "factor": 88.4,
        "detect_threshold": 15,  # values below this likely mg/dL
    },
    "temperature": {
        "from_unit": "°F",
        "to_unit": "°C",
        "factor": None,  # special: (F - 32) * 5/9
        "detect_threshold": 90,  # values above this likely °F
    },
}


# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------

@dataclass
class SchemaProfile:
    n_rows: int
    n_cols: int
    columns: list[dict[str, Any]]


@dataclass
class MissingnessResult:
    column: str
    n_missing: int
    pct_missing: float


@dataclass
class OutlierResult:
    column: str
    method: str
    n_outliers: int
    outlier_indices: list[int]
    details: str


@dataclass
class RuleViolation:
    column: str
    rule: str
    n_violations: int
    example_values: list[Any]
    indices: list[int]


@dataclass
class CleaningAction:
    action_id: str
    category: str
    description: str
    columns: list[str]
    priority: str  # high | medium | low
    auto_applicable: bool


@dataclass
class DataQualityReport:
    source: str
    generated_at: str
    schema: SchemaProfile
    missingness: list[MissingnessResult]
    outliers: list[OutlierResult]
    clinical_violations: list[RuleViolation]
    duplicates: dict[str, Any]
    unit_issues: list[dict[str, Any]]
    date_issues: list[dict[str, Any]]
    suggested_actions: list[CleaningAction]
    summary: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# 1. load_data
# ---------------------------------------------------------------------------

def load_data(
    source: str | Path | pd.DataFrame,
    sheet_name: Optional[str | int] = 0,
    sql_query: Optional[str] = None,
    connection: Any = None,
) -> pd.DataFrame:
    """
    Ingest CSV, Excel, an in-memory DataFrame, or a SQL-extracted table.

    Parameters
    ----------
    source : path, DataFrame, or ignored when sql_query + connection provided
    sheet_name : Excel sheet (default first sheet)
    sql_query : optional SQL SELECT
    connection : SQLAlchemy / DBAPI connection for SQL extraction
    """
    if isinstance(source, pd.DataFrame):
        return source.copy()

    if sql_query is not None:
        if connection is None:
            raise ValueError("SQL extraction requires a database connection.")
        return pd.read_sql(sql_query, connection)

    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {path}")

    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls", ".xlsm"}:
        return pd.read_excel(path, sheet_name=sheet_name)
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix == ".tsv":
        return pd.read_csv(path, sep="\t")

    raise ValueError(
        f"Unsupported file type '{suffix}'. Use CSV, Excel, TSV, or Parquet."
    )


# ---------------------------------------------------------------------------
# 2. profile_schema
# ---------------------------------------------------------------------------

def profile_schema(df: pd.DataFrame) -> SchemaProfile:
    """Analyse column names, inferred types, ranges, and basic stats."""
    columns: list[dict[str, Any]] = []

    for col in df.columns:
        series = df[col]
        info: dict[str, Any] = {
            "name": col,
            "dtype": str(series.dtype),
            "n_unique": int(series.nunique(dropna=True)),
            "n_missing": int(series.isna().sum()),
            "sample_values": series.dropna().head(3).tolist(),
        }

        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().sum() > 0 and numeric.notna().mean() > 0.5:
            info["inferred_type"] = "numeric"
            info["min"] = float(numeric.min())
            info["max"] = float(numeric.max())
            info["mean"] = float(numeric.mean())
            info["median"] = float(numeric.median())
            info["std"] = float(numeric.std()) if numeric.notna().sum() > 1 else 0.0
        elif _looks_like_datetime(series):
            parsed = pd.to_datetime(series, errors="coerce")
            info["inferred_type"] = "datetime"
            info["min"] = str(parsed.min()) if parsed.notna().any() else None
            info["max"] = str(parsed.max()) if parsed.notna().any() else None
        else:
            info["inferred_type"] = "categorical" if series.nunique() < 30 else "text"
            top = series.value_counts(dropna=True).head(5)
            info["top_values"] = {str(k): int(v) for k, v in top.items()}

        columns.append(info)

    return SchemaProfile(n_rows=len(df), n_cols=len(df.columns), columns=columns)


def _looks_like_datetime(series: pd.Series) -> bool:
    name = str(series.name).lower()
    if any(tok in name for tok in ("date", "time", "admission", "discharge", "dob")):
        return True
    sample = series.dropna().astype(str).head(20)
    if sample.empty:
        return False
    # Only attempt parse when values already look date-like
    date_like = sample.str.match(
        r"^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})"
    )
    if date_like.mean() < 0.7:
        return False
    if sample.str.match(r"^\d{4}-\d{2}-\d{2}").mean() >= 0.7:
        parsed = pd.to_datetime(sample, format="%Y-%m-%d", errors="coerce")
    else:
        parsed = pd.to_datetime(sample, errors="coerce")
    return parsed.notna().mean() >= 0.7


# ---------------------------------------------------------------------------
# 3. detect_missingness
# ---------------------------------------------------------------------------

def detect_missingness(df: pd.DataFrame) -> list[MissingnessResult]:
    """Summarise missing values per column (including blank strings)."""
    results: list[MissingnessResult] = []
    n = len(df) if len(df) else 1

    for col in df.columns:
        series = df[col]
        missing = series.isna()
        if series.dtype == object or pd.api.types.is_string_dtype(series):
            blank = series.astype(str).str.strip().isin(["", "nan", "None", "NA", "N/A", "."])
            missing = missing | blank
        n_missing = int(missing.sum())
        results.append(
            MissingnessResult(
                column=col,
                n_missing=n_missing,
                pct_missing=round(100.0 * n_missing / n, 2),
            )
        )

    return sorted(results, key=lambda r: r.pct_missing, reverse=True)


# ---------------------------------------------------------------------------
# 4. detect_outliers
# ---------------------------------------------------------------------------

def detect_outliers(
    df: pd.DataFrame,
    method: str = "iqr",
    z_threshold: float = 3.0,
    iqr_multiplier: float = 1.5,
) -> list[OutlierResult]:
    """
    Detect statistical outliers in numeric columns.

    Methods: 'iqr' (Tukey fences) or 'zscore'.
    """
    results: list[OutlierResult] = []

    for col in df.columns:
        numeric = pd.to_numeric(df[col], errors="coerce")
        valid = numeric.dropna()
        if len(valid) < 8:
            continue

        if method == "zscore":
            mean, std = valid.mean(), valid.std()
            if std == 0 or np.isnan(std):
                continue
            z = (numeric - mean).abs() / std
            mask = z > z_threshold
            details = f"|z| > {z_threshold} (mean={mean:.2f}, sd={std:.2f})"
        else:
            q1, q3 = valid.quantile(0.25), valid.quantile(0.75)
            iqr = q3 - q1
            lower, upper = q1 - iqr_multiplier * iqr, q3 + iqr_multiplier * iqr
            mask = (numeric < lower) | (numeric > upper)
            details = f"outside [{lower:.2f}, {upper:.2f}] (IQR×{iqr_multiplier})"

        mask = mask.fillna(False)
        indices = df.index[mask].tolist()
        if indices:
            results.append(
                OutlierResult(
                    column=col,
                    method=method,
                    n_outliers=len(indices),
                    outlier_indices=indices[:50],  # cap for report size
                    details=details,
                )
            )

    return results


# ---------------------------------------------------------------------------
# 5. clinical_rules_check (+ units, dates, duplicates)
# ---------------------------------------------------------------------------

def _resolve_column(df: pd.DataFrame, rule_key: str) -> Optional[str]:
    """Map a rule key to an actual DataFrame column via aliases."""
    aliases = COLUMN_ALIASES.get(rule_key, [rule_key])
    lower_map = {c.lower(): c for c in df.columns}
    for alias in aliases:
        if alias.lower() in lower_map:
            return lower_map[alias.lower()]
    return None


def clinical_rules_check(
    df: pd.DataFrame,
    rules: Optional[list[ClinicalRule]] = None,
    custom_rules: Optional[list[ClinicalRule]] = None,
) -> list[RuleViolation]:
    """
    Flag values outside clinical plausibility ranges.

    Pass custom_rules to extend or override the built-in library
    (rules with the same column name replace defaults).
    """
    active = {r.column: r for r in (rules or DEFAULT_CLINICAL_RULES)}
    if custom_rules:
        for rule in custom_rules:
            active[rule.column] = rule

    violations: list[RuleViolation] = []

    for key, rule in active.items():
        col = _resolve_column(df, key) or (
            rule.column if rule.column in df.columns else None
        )
        if col is None:
            continue

        numeric = pd.to_numeric(df[col], errors="coerce")
        mask = numeric.notna() & ((numeric < rule.min_value) | (numeric > rule.max_value))
        indices = df.index[mask].tolist()
        if not indices:
            continue

        examples = numeric.loc[indices].head(5).tolist()
        violations.append(
            RuleViolation(
                column=col,
                rule=rule.label(),
                n_violations=len(indices),
                example_values=examples,
                indices=indices[:50],
            )
        )

    return violations


def detect_unit_inconsistencies(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Heuristic detection of mixed / wrong laboratory units."""
    issues: list[dict[str, Any]] = []

    for key, spec in UNIT_CONVERSIONS.items():
        col = _resolve_column(df, key)
        if col is None:
            continue

        numeric = pd.to_numeric(df[col], errors="coerce").dropna()
        if numeric.empty:
            continue

        threshold = spec["detect_threshold"]
        if key in ("glucose", "temperature"):
            suspect = numeric[numeric > threshold]
            reason = f"values > {threshold} suggest {spec['from_unit']} rather than {spec['to_unit']}"
        else:  # creatinine
            suspect = numeric[numeric < threshold]
            reason = f"values < {threshold} suggest {spec['from_unit']} rather than {spec['to_unit']}"

        # Temperature °F is rare but clinically obvious — flag even a single case.
        min_suspect = 1 if key == "temperature" else max(2, int(0.05 * len(numeric)))
        if len(suspect) >= min_suspect:
            issues.append(
                {
                    "column": col,
                    "analyte": key,
                    "n_suspect": int(len(suspect)),
                    "from_unit": spec["from_unit"],
                    "to_unit": spec["to_unit"],
                    "reason": reason,
                    "example_values": suspect.head(5).tolist(),
                }
            )

    return issues


def detect_date_inconsistencies(
    df: pd.DataFrame,
    admission_col: str = "admission_date",
    discharge_col: str = "discharge_date",
) -> list[dict[str, Any]]:
    """Flag discharge earlier than admission (and similar temporal errors)."""
    issues: list[dict[str, Any]] = []
    lower_map = {c.lower(): c for c in df.columns}

    adm = lower_map.get(admission_col.lower())
    dis = lower_map.get(discharge_col.lower())

    # Also try common aliases
    if adm is None:
        for cand in ("admit_date", "admission_dt", "hosp_admit"):
            if cand in lower_map:
                adm = lower_map[cand]
                break
    if dis is None:
        for cand in ("discharge_dt", "hosp_discharge"):
            if cand in lower_map:
                dis = lower_map[cand]
                break

    if adm is None or dis is None:
        return issues

    admission = pd.to_datetime(df[adm], errors="coerce")
    discharge = pd.to_datetime(df[dis], errors="coerce")
    bad = admission.notna() & discharge.notna() & (discharge < admission)
    indices = df.index[bad].tolist()

    if indices:
        issues.append(
            {
                "type": "discharge_before_admission",
                "admission_column": adm,
                "discharge_column": dis,
                "n_violations": len(indices),
                "indices": indices[:50],
                "examples": [
                    {
                        "index": int(i),
                        "admission": str(admission.loc[i]),
                        "discharge": str(discharge.loc[i]),
                    }
                    for i in indices[:5]
                ],
            }
        )

    return issues


def detect_duplicates(
    df: pd.DataFrame,
    id_columns: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Detect fully duplicate rows and optional ID-based duplicates."""
    exact = int(df.duplicated().sum())
    result: dict[str, Any] = {
        "exact_duplicate_rows": exact,
        "exact_duplicate_indices": df.index[df.duplicated(keep=False)].tolist()[:50],
    }

    if id_columns:
        present = [c for c in id_columns if c in df.columns]
        if present:
            id_dups = int(df.duplicated(subset=present).sum())
            result["id_columns"] = present
            result["id_duplicate_rows"] = id_dups
    else:
        # Auto-detect a likely ID column
        for cand in ("patient_id", "id", "mrn", "subject_id"):
            if cand in df.columns:
                id_dups = int(df.duplicated(subset=[cand]).sum())
                result["id_columns"] = [cand]
                result["id_duplicate_rows"] = id_dups
                break

    return result


# ---------------------------------------------------------------------------
# Suggested cleaning actions
# ---------------------------------------------------------------------------

def _build_cleaning_actions(
    missingness: list[MissingnessResult],
    outliers: list[OutlierResult],
    violations: list[RuleViolation],
    duplicates: dict[str, Any],
    unit_issues: list[dict[str, Any]],
    date_issues: list[dict[str, Any]],
) -> list[CleaningAction]:
    actions: list[CleaningAction] = []
    n = 1

    for m in missingness:
        if m.pct_missing == 0:
            continue
        if m.pct_missing >= 40:
            priority, desc = "high", (
                f"Column '{m.column}' is {m.pct_missing}% missing — "
                "consider dropping the column or documenting exclusion."
            )
        elif m.pct_missing >= 10:
            priority, desc = "medium", (
                f"Impute or investigate '{m.column}' ({m.pct_missing}% missing)."
            )
        else:
            priority, desc = "low", (
                f"Minor missingness in '{m.column}' ({m.pct_missing}%) — "
                "impute median/mode or leave as NA if appropriate."
            )
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="missingness",
                description=desc,
                columns=[m.column],
                priority=priority,
                auto_applicable=m.pct_missing < 40,
            )
        )
        n += 1

    for v in violations:
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="clinical_rule",
                description=(
                    f"Set {v.n_violations} out-of-range value(s) in '{v.column}' "
                    f"to NA ({v.rule}). Review before deletion."
                ),
                columns=[v.column],
                priority="high",
                auto_applicable=True,
            )
        )
        n += 1

    for o in outliers:
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="outlier",
                description=(
                    f"Review {o.n_outliers} statistical outlier(s) in '{o.column}' "
                    f"({o.details}). Cap, winsorise, or set to NA after clinical review."
                ),
                columns=[o.column],
                priority="medium",
                auto_applicable=False,
            )
        )
        n += 1

    if duplicates.get("exact_duplicate_rows", 0) > 0:
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="duplicates",
                description=(
                    f"Remove {duplicates['exact_duplicate_rows']} exact duplicate row(s)."
                ),
                columns=[],
                priority="high",
                auto_applicable=True,
            )
        )
        n += 1

    for u in unit_issues:
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="units",
                description=(
                    f"Convert suspect {u['from_unit']} values in '{u['column']}' "
                    f"to {u['to_unit']} ({u['reason']})."
                ),
                columns=[u["column"]],
                priority="high",
                auto_applicable=True,
            )
        )
        n += 1

    for d in date_issues:
        actions.append(
            CleaningAction(
                action_id=f"A{n:02d}",
                category="datetime",
                description=(
                    f"Investigate {d['n_violations']} row(s) where "
                    f"{d['discharge_column']} < {d['admission_column']}."
                ),
                columns=[d["admission_column"], d["discharge_column"]],
                priority="high",
                auto_applicable=False,
            )
        )
        n += 1

    return actions


# ---------------------------------------------------------------------------
# 6. generate_report
# ---------------------------------------------------------------------------

def generate_report(
    df: pd.DataFrame,
    source: str = "in-memory",
    custom_rules: Optional[list[ClinicalRule]] = None,
    outlier_method: str = "iqr",
    id_columns: Optional[list[str]] = None,
) -> DataQualityReport:
    """Run the full quality pipeline and return a structured report object."""
    schema = profile_schema(df)
    missingness = detect_missingness(df)
    outliers = detect_outliers(df, method=outlier_method)
    violations = clinical_rules_check(df, custom_rules=custom_rules)
    duplicates = detect_duplicates(df, id_columns=id_columns)
    unit_issues = detect_unit_inconsistencies(df)
    date_issues = detect_date_inconsistencies(df)
    actions = _build_cleaning_actions(
        missingness, outliers, violations, duplicates, unit_issues, date_issues
    )

    high_missing = sum(1 for m in missingness if m.pct_missing >= 10)
    summary = {
        "rows": schema.n_rows,
        "columns": schema.n_cols,
        "columns_with_missing": sum(1 for m in missingness if m.n_missing > 0),
        "columns_high_missing_ge_10pct": high_missing,
        "clinical_rule_violations": sum(v.n_violations for v in violations),
        "outlier_flags": sum(o.n_outliers for o in outliers),
        "exact_duplicates": duplicates.get("exact_duplicate_rows", 0),
        "unit_issues": len(unit_issues),
        "date_issues": sum(d["n_violations"] for d in date_issues),
        "suggested_actions": len(actions),
    }

    return DataQualityReport(
        source=str(source),
        generated_at=datetime.now().isoformat(timespec="seconds"),
        schema=schema,
        missingness=missingness,
        outliers=outliers,
        clinical_violations=violations,
        duplicates=duplicates,
        unit_issues=unit_issues,
        date_issues=date_issues,
        suggested_actions=actions,
        summary=summary,
    )


def report_to_markdown(report: DataQualityReport) -> str:
    """Render a human-readable Markdown Data Quality Report."""
    s = report.summary
    lines = [
        "# Clinical Data Quality Report",
        "",
        f"**Source:** `{report.source}`  ",
        f"**Generated:** {report.generated_at}  ",
        "",
        "## Executive Summary",
        "",
        f"| Metric | Value |",
        f"| --- | ---: |",
        f"| Rows | {s.get('rows', 0)} |",
        f"| Columns | {s.get('columns', 0)} |",
        f"| Columns with missing values | {s.get('columns_with_missing', 0)} |",
        f"| Clinical rule violations | {s.get('clinical_rule_violations', 0)} |",
        f"| Statistical outlier flags | {s.get('outlier_flags', 0)} |",
        f"| Exact duplicate rows | {s.get('exact_duplicates', 0)} |",
        f"| Unit inconsistency flags | {s.get('unit_issues', 0)} |",
        f"| Date/time inconsistencies | {s.get('date_issues', 0)} |",
        f"| Suggested cleaning actions | {s.get('suggested_actions', 0)} |",
        "",
        "## 1. Schema Profile",
        "",
        f"Dataset shape: **{report.schema.n_rows}** rows × **{report.schema.n_cols}** columns.",
        "",
        "| Column | Inferred type | dtype | Missing | Min | Max | Mean |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: |",
    ]

    for col in report.schema.columns:
        lines.append(
            "| {name} | {itype} | {dtype} | {miss} | {mn} | {mx} | {mean} |".format(
                name=col["name"],
                itype=col.get("inferred_type", ""),
                dtype=col.get("dtype", ""),
                miss=col.get("n_missing", 0),
                mn=_fmt(col.get("min")),
                mx=_fmt(col.get("max")),
                mean=_fmt(col.get("mean")),
            )
        )

    lines += ["", "## 2. Missingness Summary", ""]
    if any(m.n_missing for m in report.missingness):
        lines += [
            "| Column | Missing (n) | Missing (%) |",
            "| --- | ---: | ---: |",
        ]
        for m in report.missingness:
            if m.n_missing:
                lines.append(f"| {m.column} | {m.n_missing} | {m.pct_missing} |")
    else:
        lines.append("_No missing values detected._")

    lines += ["", "## 3. Outlier Summary", ""]
    if report.outliers:
        lines += [
            "| Column | Method | Outliers (n) | Details |",
            "| --- | --- | ---: | --- |",
        ]
        for o in report.outliers:
            lines.append(
                f"| {o.column} | {o.method} | {o.n_outliers} | {o.details} |"
            )
    else:
        lines.append("_No statistical outliers flagged (or insufficient numeric data)._")

    lines += ["", "## 4. Clinical Rule Violations", ""]
    if report.clinical_violations:
        lines += [
            "| Column | Rule | Violations (n) | Example values |",
            "| --- | --- | ---: | --- |",
        ]
        for v in report.clinical_violations:
            examples = ", ".join(str(x) for x in v.example_values)
            lines.append(
                f"| {v.column} | {v.rule} | {v.n_violations} | {examples} |"
            )
    else:
        lines.append("_No clinical rule violations detected._")

    lines += ["", "## 5. Duplicates", ""]
    lines.append(
        f"- Exact duplicate rows: **{report.duplicates.get('exact_duplicate_rows', 0)}**"
    )
    if "id_duplicate_rows" in report.duplicates:
        cols = ", ".join(report.duplicates.get("id_columns", []))
        lines.append(
            f"- Duplicate IDs ({cols}): **{report.duplicates['id_duplicate_rows']}**"
        )

    lines += ["", "## 6. Unit Inconsistencies", ""]
    if report.unit_issues:
        for u in report.unit_issues:
            lines.append(
                f"- **{u['column']}** ({u['analyte']}): {u['n_suspect']} suspect "
                f"{u['from_unit']} values → convert to {u['to_unit']}. "
                f"Examples: {u['example_values']}"
            )
    else:
        lines.append("_No unit inconsistencies flagged._")

    lines += ["", "## 7. Date/Time Inconsistencies", ""]
    if report.date_issues:
        for d in report.date_issues:
            lines.append(
                f"- **{d['type']}**: {d['n_violations']} row(s) where "
                f"`{d['discharge_column']}` < `{d['admission_column']}`."
            )
            for ex in d.get("examples", []):
                lines.append(
                    f"  - row {ex['index']}: admit {ex['admission']} → "
                    f"discharge {ex['discharge']}"
                )
    else:
        lines.append("_No date/time inconsistencies flagged._")

    lines += ["", "## 8. Suggested Cleaning Actions", ""]
    if report.suggested_actions:
        lines += [
            "| ID | Priority | Category | Auto? | Description |",
            "| --- | --- | --- | --- | --- |",
        ]
        for a in report.suggested_actions:
            auto = "yes" if a.auto_applicable else "review"
            lines.append(
                f"| {a.action_id} | {a.priority} | {a.category} | {auto} | "
                f"{a.description} |"
            )
    else:
        lines.append("_No cleaning actions suggested — dataset looks clean._")

    lines += [
        "",
        "---",
        "_Generated by Clinical Data Cleaner Agent_",
        "",
    ]
    return "\n".join(lines)


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def report_to_dict(report: DataQualityReport) -> dict[str, Any]:
    """Serialize report to a JSON-friendly dictionary."""
    return asdict(report)


# ---------------------------------------------------------------------------
# 7. apply_cleaning_plan
# ---------------------------------------------------------------------------

def apply_cleaning_plan(
    df: pd.DataFrame,
    report: DataQualityReport,
    *,
    drop_duplicates: bool = True,
    nullify_clinical_violations: bool = True,
    convert_units: bool = True,
    impute_numeric: bool = False,
    drop_high_missing_cols: bool = False,
    high_missing_threshold: float = 40.0,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Apply an automated subset of the suggested cleaning plan.

    Returns (cleaned_dataframe, list_of_actions_applied).
    Conservative defaults: nullify impossible values, convert units,
    drop exact duplicates. Imputation and column drops are opt-in.
    """
    cleaned = df.copy()
    log: list[str] = []

    # Standardise blank strings → NA
    for col in cleaned.select_dtypes(include=["object", "string"]).columns:
        cleaned[col] = cleaned[col].replace(
            {"": np.nan, "nan": np.nan, "None": np.nan, "NA": np.nan, "N/A": np.nan, ".": np.nan}
        )

    if drop_duplicates and report.duplicates.get("exact_duplicate_rows", 0) > 0:
        before = len(cleaned)
        cleaned = cleaned.drop_duplicates()
        log.append(f"Removed {before - len(cleaned)} exact duplicate row(s).")

    if convert_units:
        for issue in report.unit_issues:
            col = issue["column"]
            key = issue["analyte"]
            spec = UNIT_CONVERSIONS[key]
            numeric = pd.to_numeric(cleaned[col], errors="coerce")
            threshold = spec["detect_threshold"]

            if key == "temperature":
                mask = numeric > threshold
                converted = (numeric - 32) * 5 / 9
            elif key == "glucose":
                mask = numeric > threshold
                converted = numeric * spec["factor"]
            else:  # creatinine
                mask = numeric < threshold
                converted = numeric * spec["factor"]

            n = int(mask.fillna(False).sum())
            if n:
                cleaned.loc[mask, col] = converted[mask]
                log.append(
                    f"Converted {n} value(s) in '{col}' from "
                    f"{spec['from_unit']} → {spec['to_unit']}."
                )

    if nullify_clinical_violations:
        for v in report.clinical_violations:
            # Re-check after unit conversion
            rule_match = re.match(
                r"(.+):\s*([-\d.]+)[–-]([-\d.]+)", v.rule
            )
            if not rule_match:
                continue
            lo, hi = float(rule_match.group(2)), float(rule_match.group(3))
            numeric = pd.to_numeric(cleaned[v.column], errors="coerce")
            mask = numeric.notna() & ((numeric < lo) | (numeric > hi))
            n = int(mask.sum())
            if n:
                cleaned.loc[mask, v.column] = np.nan
                log.append(
                    f"Set {n} out-of-range value(s) in '{v.column}' to NA "
                    f"(rule {lo}–{hi})."
                )

    if drop_high_missing_cols:
        for m in report.missingness:
            if m.pct_missing >= high_missing_threshold and m.column in cleaned.columns:
                cleaned = cleaned.drop(columns=[m.column])
                log.append(
                    f"Dropped column '{m.column}' ({m.pct_missing}% missing)."
                )

    if impute_numeric:
        for col in cleaned.columns:
            numeric = pd.to_numeric(cleaned[col], errors="coerce")
            if numeric.notna().mean() < 0.5:
                continue
            if numeric.isna().any() and numeric.notna().any():
                median = numeric.median()
                n = int(numeric.isna().sum())
                cleaned[col] = numeric.fillna(median)
                log.append(f"Imputed {n} missing value(s) in '{col}' with median ({median:.2f}).")

    if not log:
        log.append("No automatic cleaning steps applied.")

    return cleaned, log


# ---------------------------------------------------------------------------
# High-level API
# ---------------------------------------------------------------------------

def clean_data(
    source: str | Path | pd.DataFrame,
    mode: str = "plan",
    output_dir: str | Path = "output",
    custom_rules: Optional[list[ClinicalRule]] = None,
    outlier_method: str = "iqr",
    id_columns: Optional[list[str]] = None,
    **cleaning_kwargs: Any,
) -> dict[str, Any]:
    """
    Run the Clinical Data Cleaner Agent end-to-end.

    Parameters
    ----------
    source : file path or DataFrame
    mode : 'plan' (report only) or 'clean' (report + cleaned dataset)
    output_dir : where to write report / cleaned CSV
    custom_rules : optional extra ClinicalRule objects
    outlier_method : 'iqr' or 'zscore'
    id_columns : optional ID columns for duplicate detection
    **cleaning_kwargs : forwarded to apply_cleaning_plan()

    Returns
    -------
    dict with keys: report, markdown, cleaning_log, cleaned_df (if mode=clean),
    paths of written artefacts.
    """
    if mode not in {"plan", "clean"}:
        raise ValueError("mode must be 'plan' or 'clean'")

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    source_label = (
        "in-memory DataFrame" if isinstance(source, pd.DataFrame) else str(source)
    )
    df = load_data(source)
    report = generate_report(
        df,
        source=source_label,
        custom_rules=custom_rules,
        outlier_method=outlier_method,
        id_columns=id_columns,
    )
    markdown = report_to_markdown(report)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_md_path = out / f"data_quality_report_{stamp}.md"
    report_json_path = out / f"data_quality_report_{stamp}.json"
    report_md_path.write_text(markdown, encoding="utf-8")
    report_json_path.write_text(
        json.dumps(report_to_dict(report), indent=2, default=str),
        encoding="utf-8",
    )

    result: dict[str, Any] = {
        "report": report,
        "markdown": markdown,
        "report_md_path": str(report_md_path),
        "report_json_path": str(report_json_path),
        "cleaning_log": [],
        "cleaned_df": None,
        "cleaned_csv_path": None,
    }

    if mode == "clean":
        cleaned, log = apply_cleaning_plan(df, report, **cleaning_kwargs)
        cleaned_path = out / f"cleaned_dataset_{stamp}.csv"
        cleaned.to_csv(cleaned_path, index=False)
        result["cleaned_df"] = cleaned
        result["cleaning_log"] = log
        result["cleaned_csv_path"] = str(cleaned_path)

        # Write cleaning plan log alongside
        plan_path = out / f"cleaning_log_{stamp}.txt"
        plan_path.write_text("\n".join(log) + "\n", encoding="utf-8")
        result["cleaning_log_path"] = str(plan_path)

    return result


def add_custom_rule(
    rules: list[ClinicalRule],
    column: str,
    min_value: float,
    max_value: float,
    unit: str = "",
    description: str = "",
) -> list[ClinicalRule]:
    """Helper to append a custom clinical rule and return the new list."""
    updated = list(rules)
    updated.append(
        ClinicalRule(column, min_value, max_value, unit=unit, description=description)
    )
    return updated


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Clinical Data Cleaner Agent — profile, validate, and clean health datasets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python clinical_data_cleaner.py data/mock_patients.csv\n"
            "  python clinical_data_cleaner.py data/mock_patients.csv --mode clean\n"
            "  python clinical_data_cleaner.py patients.xlsx --mode plan --outlier-method zscore\n"
        ),
    )
    parser.add_argument("source", help="Path to CSV / Excel / TSV / Parquet file")
    parser.add_argument(
        "--mode",
        choices=["plan", "clean"],
        default="plan",
        help="plan = report only; clean = report + cleaned dataset (default: plan)",
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for reports and cleaned files (default: output)",
    )
    parser.add_argument(
        "--outlier-method",
        choices=["iqr", "zscore"],
        default="iqr",
        help="Statistical outlier method (default: iqr)",
    )
    parser.add_argument(
        "--id-columns",
        nargs="+",
        default=None,
        help="Optional ID column(s) for duplicate detection",
    )
    parser.add_argument(
        "--impute",
        action="store_true",
        help="Impute numeric missing values with column median (clean mode)",
    )
    parser.add_argument(
        "--drop-high-missing",
        action="store_true",
        help="Drop columns with ≥40%% missing (clean mode)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    result = clean_data(
        args.source,
        mode=args.mode,
        output_dir=args.output_dir,
        outlier_method=args.outlier_method,
        id_columns=args.id_columns,
        impute_numeric=args.impute,
        drop_high_missing_cols=args.drop_high_missing,
    )

    print(result["markdown"])
    print(f"\nReport saved → {result['report_md_path']}")
    print(f"JSON saved   → {result['report_json_path']}")

    if args.mode == "clean":
        print(f"Cleaned CSV  → {result['cleaned_csv_path']}")
        print("\nCleaning log:")
        for line in result["cleaning_log"]:
            print(f"  • {line}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
