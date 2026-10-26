"""System Usability Scale results (thesis Sections 3.5.4 and 3.5.5).

Reads data/sus_responses.csv (copy sus_responses_template.csv) with one
row per respondent: respondent_id, role (student or teacher), q1..q10,
each answered 1 (strongly disagree) to 5 (strongly agree).

Scoring follows Brooke (1996): odd items contribute (response - 1), even
items contribute (5 - response), and the sum is multiplied by 2.5, giving
0-100. Reports the mean, SD and 95% CI overall and by role, the nearest
adjective from Bangor et al. (2009), a one-sample Wilcoxon signed-rank
test against the benchmark of 68 (Lewis, 2018), and a Mann-Whitney U test
comparing students with teachers.

Usage (from server/):
  python scripts/evaluation/analyze_sus.py
  python scripts/evaluation/analyze_sus.py --responses path/to/responses.csv

Writes output/sus_scores.csv (per respondent) and output/sus_results.csv.
"""
import argparse
import csv
import math
import os
import sys

import numpy as np
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
ALPHA = 0.05
BENCHMARK = 68
# Mean SUS score associated with each adjective rating (Bangor et al., 2009).
ADJECTIVES = [('Worst imaginable', 12.5), ('Awful', 20.3), ('Poor', 35.7), ('OK', 50.9),
              ('Good', 71.4), ('Excellent', 85.5), ('Best imaginable', 90.9)]


def sus_score(responses):
    total = 0
    for i, r in enumerate(responses, start=1):
        total += (r - 1) if i % 2 == 1 else (5 - r)
    return total * 2.5


def nearest_adjective(score):
    return min(ADJECTIVES, key=lambda a: abs(a[1] - score))[0]


def describe(scores):
    s = np.asarray(scores, float)
    n = len(s)
    out = {'n': n, 'mean': float(s.mean()), 'median': float(np.median(s))}
    if n > 1:
        sd = float(s.std(ddof=1))
        half = float(stats.t.ppf(0.975, n - 1) * sd / math.sqrt(n))
        out.update(sd=sd, ci_low=out['mean'] - half, ci_high=out['mean'] + half)
    else:
        out.update(sd=float('nan'), ci_low=float('nan'), ci_high=float('nan'))
    out['adjective'] = nearest_adjective(out['mean'])
    if n >= 6 and np.count_nonzero(s - BENCHMARK) > 0:
        res = stats.wilcoxon(s - BENCHMARK, zero_method='wilcox', alternative='two-sided')
        out['wilcoxon_vs_68_W'], out['wilcoxon_vs_68_p'] = float(res.statistic), float(res.pvalue)
    else:
        out['wilcoxon_vs_68_W'] = out['wilcoxon_vs_68_p'] = float('nan')
    return out


def fmt(v, digits=2):
    return '' if isinstance(v, float) and not math.isfinite(v) else ((f'{v:.2e}' if v != 0 and abs(v) < 0.001 else round(v, digits)) if isinstance(v, float) else v)

def fmt_p(p):
    """p-value for printing: '< 0.0001' rather than a misleading 0.0."""
    if not (isinstance(p, float) and math.isfinite(p)):
        return 'n/a'
    return '< 0.0001' if p < 0.0001 else f'{p:.4f}'


def main():
    sys.stdout.reconfigure(errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('--responses', default=os.path.join(HERE, 'data', 'sus_responses.csv'))
    ap.add_argument('--out', default=os.path.join(HERE, 'output'))
    a = ap.parse_args()

    with open(a.responses, encoding='utf-8-sig', newline='') as f:
        raw = list(csv.DictReader(f))

    people, problems = [], []
    for r in raw:
        if not any((r.get(f'q{i}') or '').strip() for i in range(1, 11)):
            continue  # blank line
        try:
            answers = [int(r[f'q{i}']) for i in range(1, 11)]
        except (KeyError, ValueError):
            problems.append(r.get('respondent_id', '?'))
            continue
        if any(x < 1 or x > 5 for x in answers):
            problems.append(r.get('respondent_id', '?'))
            continue
        role = (r.get('role') or '').strip().lower()
        people.append({'respondent_id': r.get('respondent_id', ''), 'role': role, 'sus': sus_score(answers)})

    if problems:
        print('Rows with missing or out-of-range answers (each q1..q10 must be 1-5): ' + ', '.join(problems))
        sys.exit(1)
    if not people:
        print('No responses found.')
        sys.exit(1)

    results = [{'group': 'All', **describe([p['sus'] for p in people])}]
    for role in sorted({p['role'] for p in people}):
        group = [p['sus'] for p in people if p['role'] == role]
        results.append({'group': role or '(no role)', **describe(group)})

    students = [p['sus'] for p in people if p['role'] == 'student']
    teachers = [p['sus'] for p in people if p['role'] == 'teacher']
    mw = (stats.mannwhitneyu(students, teachers, alternative='two-sided')
          if len(students) >= 3 and len(teachers) >= 3 else None)

    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'sus_scores.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['respondent_id', 'role', 'sus'])
        w.writeheader()
        w.writerows(people)
    with open(os.path.join(a.out, 'sus_results.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        cols = list(results[0].keys()) + ['mann_whitney_U', 'mann_whitney_p']
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for i, r in enumerate(results):
            extra = ({'mann_whitney_U': fmt(float(mw.statistic)), 'mann_whitney_p': fmt(float(mw.pvalue))}
                     if i == 0 and mw else {})
            w.writerow({**{k: fmt(v) for k, v in r.items()}, **extra})

    print('\nSystem Usability Scale')
    for r in results:
        print(f"  {r['group']}: n = {r['n']}, mean {fmt(r['mean'], 1)} (SD {fmt(r['sd'], 1)}, "
              f"95% CI {fmt(r['ci_low'], 1)}-{fmt(r['ci_high'], 1)}), median {fmt(r['median'], 1)} - "
              f"'{r['adjective']}'; Wilcoxon vs {BENCHMARK}: p {'' if fmt_p(r['wilcoxon_vs_68_p']).startswith('<') else '= '}{fmt_p(r['wilcoxon_vs_68_p'])}")
    if mw:
        verdict = 'significant' if mw.pvalue < ALPHA else 'no significant'
        print(f"  Students vs teachers: Mann-Whitney U = {fmt(float(mw.statistic), 1)}, "
              f"p {'' if fmt_p(float(mw.pvalue)).startswith('<') else '= '}{fmt_p(float(mw.pvalue))} ({verdict} difference)")
    else:
        print('  Students vs teachers: not tested (needs at least 3 of each).')
    print(f"\nSaved {os.path.join(a.out, 'sus_results.csv')}")


if __name__ == '__main__':
    main()
