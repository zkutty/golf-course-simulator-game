# Public shot-distance benchmark sources

Corpus version 1 was extracted on 2026-10-21. Its 12 records are a compact set of factual public observations for population calibration. They are not fitted/interpolated game values and are not connected to the shot resolver. `distanceBenchmarks.ts` keeps the two source registries and the source observations separate; unknowns remain `null`.

| Source | Published/data period | Population and metric | Included observations |
| --- | --- | --- | --- |
| [Arccos, “Want Rapid Golf Game Improvement? Smart Distance Club Averages Are Key”](https://ca.arccosgolf.com/blogs/community/arccos-caddie-smart-distances-provide-rapid-golf-game-improvement) | Published 2020-04-24; data period not specified | Arccos users; article calls the quoted club distances medians of actual distance hit. The 7-iron and pitching-wedge values are grouped at scratch, 10 handicap, and 20 handicap. Cohort counts and further population details are not stated. | 7-iron: 159, 148, 140 yd; pitching wedge: 122, 114, 104 yd, respectively. Article identifies Smart Distance as an expected well-struck-shot estimate excluding mishits and abnormally long shots, but does not establish that these cited median observations are carry-only. Carry status is therefore `unspecified`. |
| [Shot Scope, “Transform Your Game & Save 4.1 Shots” data booklet](https://shotscope.com/assets/Shot-Scope-Data-Booklet-low-res-1.pdf) | Publication and data periods not stated | Shot Scope performance-tracking users. The booklet says its database exceeds 350 million shots and defines Performance Average as the average after excluding major outliers. It does not give sample sizes for the distance cohorts. | Off-the-tee P-Avg: scratch 285, 5 handicap 259, 10 handicap 256, 15 handicap 238, 20 handicap 225, 25 handicap 204 yd. Printed page 10 / PDF page 6. The booklet does not establish carry versus total or a driver-only sample, so carry status is `unspecified` and club is `null`. |

These are different metrics and populations. Preserve the source labels and non-monotonic Shot Scope 5/10 handicap values as printed; do not average the sources or silently smooth them. Arccos 2020 medians, Shot Scope filtered averages, tee-only drive observations, and carry distances are not interchangeable.

## Additional source metadata, not observations

[Arccos's 2026 Annual Driving Distance Report announcement](https://uk.arccosgolf.com/blogs/community/arccos-golf-releases-largest-ever-annual-driving-distance-report-leveraging-data-from-25-million-rounds-to-deliver-eight-year-trend-analysis-across-age-gender-and-skill-level) is retained in code as metadata only. The announcement is dated 2026-05-06 and describes 2025 play, more than 5 million rounds, and nearly 10 million driver tee shots, with cohorts by age, gender, and handicap. We have not added values from its linked report because those detailed anchors have not been extracted and spot-checked for this corpus.

## Access and reuse notes

The linked article and booklet are publicly readable first-party publications. Public access alone does not grant a reproduction license. This corpus records a small set of factual numeric observations with attribution and source links, not the source tables or a wholesale copy. Confirm applicable reuse rights before redistributing this corpus beyond the project. No private dashboard/API access, scraping, or network dependency is used.

The corpus schema requires yards, an explicit metric, and an explicit carry status. For these cited anchors the status is unknown, so records use `unspecified`; validators reject relabeling them as carry or changing either source's metric. A later fitted value must live in a separate versioned calibration artifact with its derivation and must not overwrite these source observations.
