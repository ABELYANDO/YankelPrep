"""AI marking vs teacher marking (thesis Sections 3.5.4 and 3.5.5).

Joins the teacher's completed marking sheet to the AI marks key (both
produced by exportMarkingSample.js) and reports, overall and by subject,
input type (typed vs handwritten) and source:

  - quadratic weighted kappa (QWK): pooled over all answers after
    expressing marks as a percentage of the maximum and rounding to the
    nearest 10% (11 levels), and within each group of questions that
    share the same maximum mark (integer marks)
  - Spearman rank correlation and its p-value
  - mean absolute error, in marks and as a percentage of the maximum
  - exact agreement (same mark after rounding) and adjacent agreement
    (within one mark)
  - bootstrap 95% confidence intervals for pooled QWK and MAE (%)
  - Wilcoxon signed-rank test on the paired AI - teacher differences (%)
  - Bland-Altman mean difference and 95% limits of agreement (%)

Usage (from server/):
  python scripts/evaluation/analyze_marking.py
  python scripts/evaluation/analyze_marking.py --sheet path/to/sheet.csv --key path/to/key.csv

Writes output/marking_results.csv, output/marking_qwk_by_max_mark.csv and
output/bland_altman.png (if matplotlib is installed).
"""
import argparse
import csv
import math
import os
import sys

import numpy as np
from scipy import stats
from sklearn.metrics import cohen_kappa_score

HERE = os.path.dirname(os.path.abspath(__file__))
ALPHA = 0.05
BOOTSTRAP_RESAMPLES = 2000
SEED = 2026


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def round_half_up(x):
    return np.floor(np.asarray(x, dtype=float) + 0.5).astype(int)


def qwk(a, b, labels):
    """Quadratic weighted kappa; NaN when undefined (e.g. one category only)."""
    a, b = list(a), list(b)
    if len(a) < 2 or len(set(a) | set(b)) < 2:
        return float('nan')
    with np.errstate(divide='ignore', invalid='ignore'):
        k = cohen_kappa_score(a, b, weights='quadratic', labels=labels)
    return float(k) if np.isfinite(k) else float('nan')


def pooled_qwk(ai_pct, teacher_pct):
    # Percent of maximum, rounded to the nearest 10% -> levels 0..10.
    return qwk(round_half_up(ai_pct / 10), round_half_up(teacher_pct / 10), labels=list(range(11)))


def bootstrap_ci(values_fn, n, rng):
    estimates = []
    for _ in range(BOOTSTRAP_RESAMPLES):
        idx = rng.integers(0, n, n)
        v = values_fn(idx)
        if np.isfinite(v):
            estimates.append(v)
    if len(estimates) < BOOTSTRAP_RESAMPLES * 0.5:
        return float('nan'), float('nan')
    lo, hi = np.percentile(estimates, [2.5, 97.5])
    return float(lo), float(hi)


def summarise(rows, rng):
    ai = np.array([r['ai_mark'] for r in rows], dtype=float)
    te = np.array([r['teacher_mark'] for r in rows], dtype=float)
    mx = np.array([r['max_marks'] for r in rows], dtype=float)
    ai_pct, te_pct = 100 * ai / mx, 100 * te / mx
    diff_pct = ai_pct - te_pct
    n = len(rows)

    out = {'n': n}
    out['qwk_pooled'] = pooled_qwk(ai_pct, te_pct)
    if n >= 10:
        out['qwk_ci_low'], out['qwk_ci_high'] = bootstrap_ci(
            lambda i: pooled_qwk(ai_pct[i], te_pct[i]), n, rng)
    else:
        out['qwk_ci_low'] = out['qwk_ci_high'] = float('nan')

    if n >= 3 and np.ptp(ai_pct) > 0 and np.ptp(te_pct) > 0:
        rho, p = stats.spearmanr(ai_pct, te_pct)
        out['spearman_rho'], out['spearman_p'] = float(rho), float(p)
    else:
        out['spearman_rho'] = out['spearman_p'] = float('nan')

    out['mae_marks'] = float(np.mean(np.abs(ai - te)))
    out['mae_pct'] = float(np.mean(np.abs(diff_pct)))
    if n >= 10:
        out['mae_pct_ci_low'], out['mae_pct_ci_high'] = bootstrap_ci(
            lambda i: float(np.mean(np.abs(diff_pct[i]))), n, rng)
    else:
        out['mae_pct_ci_low'] = out['mae_pct_ci_high'] = float('nan')

    out['exact_agreement'] = float(np.mean(round_half_up(ai) == round_half_up(te)))
    out['adjacent_agreement'] = float(np.mean(np.abs(ai - te) <= 1))

    # Systematic over/under-marking: Wilcoxon signed-rank on paired
    # differences. Needs some non-zero differences to be defined.
    if n >= 6 and np.count_nonzero(diff_pct) > 0:
        res = stats.wilcoxon(diff_pct, zero_method='wilcox', alternative='two-sided')
        out['wilcoxon_W'], out['wilcoxon_p'] = float(res.statistic), float(res.pvalue)
    else:
        out['wilcoxon_W'] = out['wilcoxon_p'] = float('nan')

    mean_diff = float(np.mean(diff_pct))
    sd_diff = float(np.std(diff_pct, ddof=1)) if n > 1 else float('nan')
    out['mean_diff_pct'] = mean_diff
    out['loa_low_pct'] = mean_diff - 1.96 * sd_diff
    out['loa_high_pct'] = mean_diff + 1.96 * sd_diff
    return out


def qwk_by_max_mark(rows):
    groups = {}
    for r in rows:
        groups.setdefault(int(round(r['max_marks'])), []).append(r)
    out = []
    for m, g in sorted(groups.items()):
        ai = round_half_up([r['ai_mark'] for r in g])
        te = round_half_up([r['teacher_mark'] for r in g])
        out.append({'max_marks': m, 'n': len(g), 'qwk': qwk(ai, te, labels=list(range(m + 1)))})
    return out


def interpret_kappa(k):
    # Landis & Koch (1977)
    if not np.isfinite(k):
        return 'undefined'
    for limit, label in [(0, 'poor'), (0.20, 'slight'), (0.40, 'fair'), (0.60, 'moderate'),
                         (0.80, 'substantial'), (1.00, 'almost perfect')]:
        if k <= limit:
            return label
    return 'almost perfect'


def fmt(v, digits=3):
    return '' if v is None or (isinstance(v, float) and not math.isfinite(v)) else (f'{v:.2e}' if v != 0 and abs(v) < 0.001 else round(v, digits))

def fmt_p(p):
    """p-value for printing: '< 0.0001' rather than a misleading 0.0."""
    if not (isinstance(p, float) and math.isfinite(p)):
        return 'n/a'
    return '< 0.0001' if p < 0.0001 else f'{p:.4f}'


def main():
    sys.stdout.reconfigure(errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', default=os.path.join(HERE, 'data', 'teacher_marking_sheet.csv'))
    ap.add_argument('--key', default=os.path.join(HERE, 'data', 'ai_marks_key.csv'))
    ap.add_argument('--out', default=os.path.join(HERE, 'output'))
    a = ap.parse_args()

    sheet = {r['answer_id']: r for r in read_csv(a.sheet)}
    key = read_csv(a.key)

    rows, unmarked, invalid = [], [], []
    for k in key:
        s = sheet.get(k['answer_id'])
        raw = (s or {}).get('teacher_mark', '').strip()
        if not raw:
            unmarked.append(k['answer_id'])
            continue
        try:
            t, ai_mark, mx = float(raw), float(k['ai_mark']), float(k['max_marks'])
        except ValueError:
            invalid.append((k['answer_id'], raw))
            continue
        if not (0 <= t <= mx) or not (0 <= ai_mark <= mx) or mx <= 0:
            invalid.append((k['answer_id'], raw))
            continue
        rows.append({**k, 'teacher_mark': t, 'ai_mark': ai_mark, 'max_marks': mx})

    if invalid:
        print('Marks outside 0..max or not numbers - fix these in the sheet first:')
        for aid, raw in invalid:
            print(f'  {aid}: {raw!r}')
        sys.exit(1)
    if unmarked:
        print(f'Note: {len(unmarked)} answer(s) have no teacher mark yet and are left out.')
    if len(rows) < 2:
        print('Not enough marked answers to analyse.')
        sys.exit(1)

    rng = np.random.default_rng(SEED)
    results = []

    def add(group, value, subset):
        if len(subset) >= 2:
            results.append({'group': group, 'value': value, **summarise(subset, rng)})

    add('overall', 'all', rows)
    for field in ['subject', 'input_type', 'source', 'exam_type']:
        for v in sorted({r[field] for r in rows}):
            add(field, v, [r for r in rows if r[field] == v])

    os.makedirs(a.out, exist_ok=True)
    cols = list(results[0].keys())
    with open(os.path.join(a.out, 'marking_results.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in results:
            w.writerow({c: fmt(r[c]) if isinstance(r[c], float) else r[c] for c in cols})

    by_max = qwk_by_max_mark(rows)
    with open(os.path.join(a.out, 'marking_qwk_by_max_mark.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['max_marks', 'n', 'qwk'])
        w.writeheader()
        for r in by_max:
            w.writerow({**r, 'qwk': fmt(r['qwk'])})

    o = results[0]
    print(f"\nAI vs teacher marking - {o['n']} answers")
    print(f"  QWK (pooled, 10% bands): {fmt(o['qwk_pooled'])} "
          f"[95% CI {fmt(o['qwk_ci_low'])}-{fmt(o['qwk_ci_high'])}] - {interpret_kappa(o['qwk_pooled'])} agreement")
    print(f"  Spearman rho: {fmt(o['spearman_rho'])} (p {'' if fmt_p(o['spearman_p']).startswith('<') else '= '}{fmt_p(o['spearman_p'])})")
    print(f"  MAE: {fmt(o['mae_marks'], 2)} marks, {fmt(o['mae_pct'], 1)}% of max "
          f"[95% CI {fmt(o['mae_pct_ci_low'], 1)}-{fmt(o['mae_pct_ci_high'], 1)}]")
    print(f"  Exact agreement: {fmt(100 * o['exact_agreement'], 1)}%   "
          f"Within one mark: {fmt(100 * o['adjacent_agreement'], 1)}%")
    sig = '' if not math.isfinite(o['wilcoxon_p']) else \
        (' - significant systematic difference' if o['wilcoxon_p'] < ALPHA else ' - no significant systematic difference')
    print(f"  Mean AI - teacher: {fmt(o['mean_diff_pct'], 1)} percentage points; "
          f"Wilcoxon p {'' if fmt_p(o['wilcoxon_p']).startswith('<') else '= '}{fmt_p(o['wilcoxon_p'])}{sig}")
    print(f"  Bland-Altman 95% limits of agreement: {fmt(o['loa_low_pct'], 1)} to {fmt(o['loa_high_pct'], 1)} points")
    print('  QWK by maximum mark: ' + ', '.join(f"{r['max_marks']}m n={r['n']}: {fmt(r['qwk'])}" for r in by_max))
    print(f"\nSaved {os.path.join(a.out, 'marking_results.csv')} (overall and per subject/input type/source)")

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        ai_pct = np.array([100 * r['ai_mark'] / r['max_marks'] for r in rows])
        te_pct = np.array([100 * r['teacher_mark'] / r['max_marks'] for r in rows])
        mean_pct, diff_pct = (ai_pct + te_pct) / 2, ai_pct - te_pct
        plt.rcParams['font.family'] = 'Times New Roman'
        fig, ax = plt.subplots(figsize=(6, 4), dpi=300)
        ax.scatter(mean_pct, diff_pct, s=12, color='black', alpha=0.6)
        for y, style, label in [(o['mean_diff_pct'], '-', 'Mean difference'),
                                (o['loa_low_pct'], '--', '95% limits of agreement'),
                                (o['loa_high_pct'], '--', None)]:
            ax.axhline(y, color='black', linestyle=style, linewidth=1, label=label)
        ax.set_xlabel('Mean of AI and teacher marks (% of maximum)')
        ax.set_ylabel('AI mark - teacher mark (percentage points)')
        # Legend above the axes so it never covers a limit-of-agreement line.
        ax.legend(frameon=False, fontsize=8, loc='lower center', bbox_to_anchor=(0.5, 1.0), ncol=2)
        fig.tight_layout()
        fig.savefig(os.path.join(a.out, 'bland_altman.png'))
        print(f"Saved {os.path.join(a.out, 'bland_altman.png')}")
    except ImportError:
        print('(matplotlib not installed - Bland-Altman plot skipped)')


if __name__ == '__main__':
    main()
