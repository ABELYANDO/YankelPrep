"""Topic prediction hold-out results (thesis Sections 3.5.4 and 3.5.5).

Reads output/prediction_cases.json (from evaluatePredictions.js). For each
subject and target year:

  H = topics the engine placed in the 'hot' tier
  A = topics actually examined in the held-out paper
  C = candidate topics (every topic the engine ranked, i.e. seen in training)

  precision = |H n A| / |H|,  recall = |H n A| / |A|,  F1
  precision@k (k = 5, 10) for the engine's ranking and for the frequency
    baseline; the random baseline's expected precision is |A n C| / |C|
  one-sided hypergeometric test: P(at least |H n A| hits if |H| topics
    were drawn at random from C)
  'new' topics: in A but never examined before, so not predictable

Across all cases, Wilcoxon signed-rank tests compare the engine's
precision@k with the frequency baseline and with the random baseline.

Usage (from server/):
  python scripts/evaluation/analyze_predictions.py

Writes output/prediction_results.csv (one row per case) and
output/prediction_summary.csv.
"""
import argparse
import csv
import json
import math
import os
import sys

import numpy as np
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
ALPHA = 0.05
KS = (5, 10)


def precision_at_k(ranking, actual, k):
    top = ranking[:k]
    return len(set(top) & actual) / len(top) if top else float('nan')


def safe_div(a, b):
    return a / b if b else float('nan')


def evaluate_case(case):
    ranked = [t['key'] for t in case['ranked']]
    freq = [t['key'] for t in case['frequencyRanked']]
    hot = {t['key'] for t in case['ranked'] if t['tier'] == 'hot'}
    candidates = set(ranked)
    actual = {t['key'] for t in case['actualTopics']}
    predictable = actual & candidates
    hits = hot & actual

    precision = safe_div(len(hits), len(hot))
    recall = safe_div(len(hits), len(actual))
    f1 = (2 * precision * recall / (precision + recall)
          if np.isfinite(precision) and np.isfinite(recall) and precision + recall > 0 else
          (0.0 if np.isfinite(precision) and np.isfinite(recall) else float('nan')))

    # P(X >= hits), X ~ Hypergeometric(population |C|, successes |A n C|, draws |H|)
    p_hyper = (float(stats.hypergeom.sf(len(hits) - 1, len(candidates), len(predictable), len(hot)))
               if hot and candidates else float('nan'))

    row = {
        'exam_type': case['examType'], 'subject': case['subject'], 'target_year': case['targetYear'],
        'train_years': f"{case['trainYears'][0]}-{case['trainYears'][-1]} ({len(case['trainYears'])})",
        'train_questions': case['trainQuestions'], 'test_questions': case['testQuestions'],
        'candidate_topics': len(candidates), 'examined_topics': len(actual),
        'new_topics': len(actual - candidates), 'hot_topics': len(hot), 'hot_hits': len(hits),
        'precision_hot': precision, 'recall_hot': recall, 'f1_hot': f1,
        'random_expected_precision': safe_div(len(predictable), len(candidates)),
        'hypergeom_p': p_hyper,
    }
    for k in KS:
        row[f'engine_p@{k}'] = precision_at_k(ranked, actual, k)
        row[f'frequency_p@{k}'] = precision_at_k(freq, actual, k)
    row['distinct_confidence_levels'] = len({t['confidence'] for t in case['ranked']})
    if 'shares' in case:
        row.update(emphasis(case))
    return row


def spearman_or_zero(x, y):
    """Spearman rho; a constant ranking carries no information, so rho = 0."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    if len(x) < 3 or np.ptp(y) == 0:
        return float('nan'), float('nan')
    if np.ptp(x) == 0:
        return 0.0, 1.0
    r, p = stats.spearmanr(x, y)
    return float(r), float(p)


def emphasis(case):
    """Exploratory: does a ranking predict each topic's SHARE of the target
    paper's questions (topic emphasis), not just whether it appears?
    Compared over the candidate topics: the engine's score, the topic's
    share in the most recent training paper, and its share across all
    training papers."""
    keys = [t['key'] for t in case['ranked']]
    target = [case['shares']['target'].get(k, 0.0) for k in keys]
    out = {}
    for name, x in [('engine', [t.get('rawScore', t['confidence']) for t in case['ranked']]),
                    ('last_year_share', [case['shares']['lastTrainYear'].get(k, 0.0) for k in keys]),
                    ('training_share', [case['shares']['train'].get(k, 0.0) for k in keys])]:
        out[f'emphasis_rho_{name}'], out[f'emphasis_p_{name}'] = spearman_or_zero(x, target)
    return out


def one_sample_wilcoxon(x):
    x = np.asarray([v for v in x if np.isfinite(v)], float)
    if len(x) < 6 or np.count_nonzero(x) == 0:
        return len(x), float('nan'), float('nan')
    res = stats.wilcoxon(x, zero_method='wilcox', alternative='two-sided')
    return len(x), float(res.statistic), float(res.pvalue)


def paired_wilcoxon(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    keep = np.isfinite(x) & np.isfinite(y)
    x, y = x[keep], y[keep]
    if len(x) < 6 or np.count_nonzero(x - y) == 0:
        return len(x), float('nan'), float('nan')
    res = stats.wilcoxon(x, y, zero_method='wilcox', alternative='two-sided')
    return len(x), float(res.statistic), float(res.pvalue)


def mean_sd(values):
    v = np.asarray([x for x in values if np.isfinite(x)], float)
    if len(v) == 0:
        return float('nan'), float('nan')
    return float(v.mean()), (float(v.std(ddof=1)) if len(v) > 1 else float('nan'))


def fmt(v, digits=3):
    return '' if isinstance(v, float) and not math.isfinite(v) else ((f'{v:.2e}' if v != 0 and abs(v) < 0.001 else round(v, digits)) if isinstance(v, float) else v)

def fmt_p(p):
    """p-value for printing: '< 0.0001' rather than a misleading 0.0."""
    if not (isinstance(p, float) and math.isfinite(p)):
        return 'n/a'
    return '< 0.0001' if p < 0.0001 else f'{p:.4f}'


def main():
    sys.stdout.reconfigure(errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('--cases', default=os.path.join(HERE, 'output', 'prediction_cases.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'output'))
    ap.add_argument('--tag', default='', help='suffix for output file names, e.g. "_all_years"')
    a = ap.parse_args()

    with open(a.cases, encoding='utf-8') as f:
        data = json.load(f)
    cases = data['cases']
    if not cases:
        print('No cases to analyse - run evaluatePredictions.js first (see its skipped list).')
        sys.exit(1)

    rows = [evaluate_case(c) for c in cases]
    os.makedirs(a.out, exist_ok=True)
    results_name, summary_name = f'prediction_results{a.tag}.csv', f'prediction_summary{a.tag}.csv'
    with open(os.path.join(a.out, results_name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: fmt(v) for k, v in r.items()})

    summary = []
    for label, subset in [('All', rows)] + [(et, [r for r in rows if r['exam_type'] == et])
                                             for et in sorted({r['exam_type'] for r in rows})]:
        if not subset:
            continue
        s = {'group': label, 'cases': len(subset)}
        for metric in ['precision_hot', 'recall_hot', 'f1_hot', 'random_expected_precision'] + \
                      [f'{m}_p@{k}' for k in KS for m in ('engine', 'frequency')]:
            s[f'{metric}_mean'], s[f'{metric}_sd'] = mean_sd([r[metric] for r in subset])
        s['cases_better_than_chance'] = sum(1 for r in subset if np.isfinite(r['hypergeom_p']) and r['hypergeom_p'] < ALPHA)
        for k in KS:
            n, W, p = paired_wilcoxon([r[f'engine_p@{k}'] for r in subset], [r[f'frequency_p@{k}'] for r in subset])
            s[f'wilcoxon_vs_frequency_p@{k}_n'], s[f'wilcoxon_vs_frequency_p@{k}_W'], s[f'wilcoxon_vs_frequency_p@{k}_p'] = n, W, p
            n, W, p = paired_wilcoxon([r[f'engine_p@{k}'] for r in subset], [r['random_expected_precision'] for r in subset])
            s[f'wilcoxon_vs_random_p@{k}_n'], s[f'wilcoxon_vs_random_p@{k}_W'], s[f'wilcoxon_vs_random_p@{k}_p'] = n, W, p
        if 'emphasis_rho_engine' in subset[0]:
            for name in ('engine', 'last_year_share', 'training_share'):
                rhos = [r[f'emphasis_rho_{name}'] for r in subset]
                s[f'emphasis_rho_{name}_mean'], s[f'emphasis_rho_{name}_sd'] = mean_sd(rhos)
                n, W, p = one_sample_wilcoxon(rhos)
                s[f'emphasis_rho_{name}_vs0_p'] = p
            n, W, p = paired_wilcoxon([r['emphasis_rho_last_year_share'] for r in subset],
                                      [r['emphasis_rho_engine'] for r in subset])
            s['emphasis_last_year_vs_engine_n'], s['emphasis_last_year_vs_engine_W'], s['emphasis_last_year_vs_engine_p'] = n, W, p
        summary.append(s)

    with open(os.path.join(a.out, summary_name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(summary[0].keys()))
        w.writeheader()
        for s in summary:
            w.writerow({k: fmt(v) for k, v in s.items()})

    s = summary[0]
    print(f"\nTopic prediction hold-out - {s['cases']} subject-year case(s)")
    print(f"  Hot tier: precision {fmt(s['precision_hot_mean'])} (SD {fmt(s['precision_hot_sd'])}), "
          f"recall {fmt(s['recall_hot_mean'])}, F1 {fmt(s['f1_hot_mean'])}")
    for k in KS:
        print(f"  P@{k}: engine {fmt(s[f'engine_p@{k}_mean'])}, frequency baseline {fmt(s[f'frequency_p@{k}_mean'])}, "
              f"random {fmt(s['random_expected_precision_mean'])}; "
              f"Wilcoxon vs frequency p: {fmt_p(s[f'wilcoxon_vs_frequency_p@{k}_p'])} "
              f"(n = {s[f'wilcoxon_vs_frequency_p@{k}_n']}), vs random p: {fmt_p(s[f'wilcoxon_vs_random_p@{k}_p'])}")
    print(f"  Cases significantly better than chance (hypergeometric p < {ALPHA}): "
          f"{s['cases_better_than_chance']} of {s['cases']}")
    print(f"  New (unpredictable) topics across all cases: {sum(r['new_topics'] for r in rows)} "
          f"of {sum(r['examined_topics'] for r in rows)} examined")
    print(f"  Cases where every candidate topic got the same confidence: "
          f"{sum(1 for r in rows if r['distinct_confidence_levels'] == 1)} of {len(rows)}")
    if 'emphasis_rho_engine_mean' in s:
        print('  Exploratory - topic emphasis (Spearman rho with each topic\'s share of the target paper):')
        for name, label in [('engine', 'engine score'), ('last_year_share', 'share in last paper'),
                            ('training_share', 'share across training papers')]:
            print(f"    {label}: mean rho {fmt(s[f'emphasis_rho_{name}_mean'])} "
                  f"(SD {fmt(s[f'emphasis_rho_{name}_sd'])}); Wilcoxon vs 0 p: {fmt_p(s[f'emphasis_rho_{name}_vs0_p'])}")
        print(f"    last-paper share vs engine (paired Wilcoxon): p: {fmt_p(s['emphasis_last_year_vs_engine_p'])} "
              f"(n = {s['emphasis_last_year_vs_engine_n']})")
    if s['cases'] < 6:
        print('  Note: fewer than 6 cases, so the Wilcoxon tests are not reported (too few pairs).')
    print(f"\nSaved {os.path.join(a.out, results_name)} and {summary_name}")


if __name__ == '__main__':
    main()
