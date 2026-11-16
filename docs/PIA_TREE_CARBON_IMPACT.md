# PIA Tree Carbon Impact (MVP)

PIA reports a modelled time-based estimate. It is not a verified carbon credit, measured carbon stock, or claim of permanent carbon removal.

## Calculation

For each planting, the service matches the confirmed tree name to the versioned factor library. Unknown or unmatched names use `GLOBAL-TREE-FALLBACK-V1`. When available, the service uses the latest reviewer-approved survival count. Until a survival count is verified, it provisionally assumes all recorded planted trees are alive and clearly labels the impact as provisional. An approved `dead`, `missing`, `harvested`, or `removed` observation sets survival to zero. Counts greater than the planted count are reported as data errors and excluded.

`elapsedDays = max(0, (calculationTimestamp - plantingDate) / 86,400,000)`

`progress = min(elapsedDays / (20 × 365.25), 1)`

`assumed surviving count = verified surviving count, if available; otherwise planted count`

`estimated tCO2e = lifetime factor × assumed surviving count × progress`

`projected lifetime tCO2e = lifetime factor × assumed surviving count`

Results are calculated per planting and species, then summed for project and organisation totals. Tree cards show kilograms; project and organisation summaries show tonnes. Future planting dates have zero elapsed progress. Missing planting dates are ineligible. Allocation stops at 100% after 20 years.

## Factor library

Factors below are conservative, low-confidence MVP planning values provided by the product owner. Annualised values are lifetime tonnes × 1,000 ÷ 20.

| Common name | Scientific name | Lifetime tCO2e per surviving tree | Annualised kgCO2e/tree/year | Factor ID |
| --- | --- | ---: | ---: | --- |
| Teak | *Tectona grandis* | 0.50 | 25 | `TEC-GRANDIS-V1` |
| Neem | *Azadirachta indica* | 0.35 | 17.5 | `AZA-INDICA-V1` |
| Mango | *Mangifera indica* | 0.40 | 20 | `MAN-INDICA-V1` |
| Jamun | *Syzygium cumini* | 0.35 | 17.5 | `SYZ-CUMINI-V1` |
| Peepal | *Ficus religiosa* | 0.60 | 30 | `FIC-RELIGIOSA-V1` |
| Banyan | *Ficus benghalensis* | 0.80 | 40 | `FIC-BENGHALENSIS-V1` |
| Arjun | *Terminalia arjuna* | 0.40 | 20 | `TER-ARJUNA-V1` |
| Karanj | *Pongamia pinnata* | 0.40 | 20 | `PON-PINNATA-V1` |
| Shisham | *Dalbergia sissoo* | 0.45 | 22.5 | `DAL-SISSOO-V1` |
| Global fallback | Unknown species | 0.30 | 15 | `GLOBAL-TREE-FALLBACK-V1` |

Each factor release is immutable and identified by `PIA-TREE-CARBON-FACTORS-V1`. A later factor update must use a new version and factor IDs; saved snapshots retain their original inputs, factor version/source, outputs, and timestamp.

## Survival verification

Growth evidence can include `survivingCount` as a non-negative whole number. It becomes the latest verified count only after an organisation reviewer approves that observation. Terminal stages set the count to zero. A newer approved observation without a count does not erase a previously verified count. For seed spots, the count represents living seedlings from the original seed count; for an individual sapling/tree record it is normally zero or one. A count greater than the original planted count is surfaced as a data error rather than rejected or silently capped. Pending survival verification does not block PIA calculations or report generation; estimates use the planted count provisionally and replace it with the approved count when available.

## API and persistence

- `GET /partner-app/projects/:id` includes `project.carbonImpact` and a `carbonImpact` result on each returned tree record.
- `GET /partner-app/projects/carbon-impact/organisation?orgId=...` returns organisation totals, species breakdowns, and project summaries. Access is scoped by membership/collaboration and department.
- Project snapshots are stored in `partnerProjects/{projectId}/piaTreeCarbonImpactCalculations/{calculationId}` and the current summary is cached on the project document.
- Organisation snapshots are stored in `organizations/{orgId}/piaTreeCarbonImpactCalculations/{calculationId}`.

The app labels all values as estimates and shows the disclaimer: “Modelled estimate only. Not a verified carbon credit, measured carbon stock, or claim of permanent carbon removal.” Plantings without verified survival remain visible as pending, not as zero impact.
