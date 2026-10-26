# Evaluation scripts

These scripts produce the results for thesis Chapter 4, following the design in Chapter 3 (Sections 3.5.3–3.5.5). The Node scripts read the database and run YankelPrep's own code. The Python scripts do the statistics.

Run everything from `server/`. The Node scripts need `MONGODB_URI` in `server/.env`. The Python scripts need their libraries installed once:

```
pip install -r scripts/evaluation/requirements.txt
```

`data/` holds students' answers and `output/` holds results. Both folders are git-ignored, so keep them out of the repository.

## 1. Question bank statistics (Chapter 4's first table)

```
npm run eval:dataset
```

Writes `output/dataset_stats.csv`: questions per exam type and subject, past-paper vs practice, MCQ vs essay, year range, distinct years and topics, and the number pending review.

## 2. Topic prediction (hold-out)

```
npm run eval:predictions
python scripts/evaluation/analyze_predictions.py
```

For each subject, the three most recent years that have earlier data become target years. Each target paper is predicted using only earlier papers, with the engine's reference year set to the target year. You can change this with `--examType=`, `--subjects=`, `--targets=2023,2024` or `--lastN=`. BECE only uses papers from 2024 onwards (the current curriculum), so a BECE target year needs an earlier post-2024 year to train on.

Results go to `output/prediction_results.csv` (one row per subject and year) and `output/prediction_summary.csv`.

## 3. AI marking vs teacher

```
npm run eval:export-marking
```

1. Give the teacher `data/teacher_marking_sheet.csv` **only**. They fill in `teacher_mark` for each row using the question, model answer and mark allocation, and can leave rows blank. The sheet doesn't show the AI's mark, so the teacher marks blind.
2. Keep `data/ai_marks_key.csv` away from the teacher.
3. Save the teacher's completed sheet over `data/teacher_marking_sheet.csv` (still CSV), then run:

```
python scripts/evaluation/analyze_marking.py
```

Results go to `output/marking_results.csv` (overall, then by subject, typed vs handwritten, and source), `output/marking_qwk_by_max_mark.csv` and `output/bland_altman.png`.

Practice answers are only eligible if they were saved after the fix that stores the student's answer with each practice question. Earlier practice sessions didn't record the answer text.

## 4. Usability (SUS)

Print `SUS_questionnaire.md` for participants. Copy `sus_responses_template.csv` to `data/sus_responses.csv` and enter one row per respondent: an ID (not a name), the role (`student` or `teacher`) and the ten answers (1–5). Then run:

```
python scripts/evaluation/analyze_sus.py
```

Results go to `output/sus_scores.csv` and `output/sus_results.csv`.
