# V1 To V2 Parity Checklist

Use this checklist after the first Supabase import. V2 should not replace V1 until these numbers match or each difference is explained.

## Source Counts

- Top Shelf Data retailer rows
- Unique retailer licenses after normalization
- Stores with coordinates
- Stores missing coordinates but with street address
- Territory rep assignment rows
- Monthly revenue rows
- Cultivera order rows
- Cultivera paid line-item rows
- Team contact log rows
- Store contact rows

## Store Rollup

- Total retailers loaded
- Revenue total by store
- Latest populated revenue month
- Latest month revenue by store
- K. Savage last active month by store
- K. Savage last active revenue by store
- K. Savage monthly run rate by store

## Brand Activity

- Active-window revenue by brand and store
- `Carries K. Savage`
- `Carries Mayfield`
- `Carries Leisure Land`
- K. Savage historical revenue
- K. Savage latest order date and amount
- Latest order date and amount

## Territory Signals

Run with V1 defaults first:

- Brand window: 120 days
- Proximity radius: 0.25 miles
- Include unmapped: current V1 default

Compare:

- `Needs location`
- `Carries K. Savage`
- `K Savage Lapsed - High Priority`
- `K Savage Lapsed - Medium Priority`
- `K Savage Lapsed - Low Priority`
- `Leisure Land Placed`
- `Pitch Mayfield`
- `Mayfield placed`
- `Maintain K. Savage`
- `Open Lane - High Priority`
- `Open Lane - Medium Priority`
- `Open Lane - Low Priority`
- `All Other Retailers`
- `No recent brand`

## Contact Log

Compare by store:

- Has contact ever
- Has contact this month
- Has contact this week
- Most recent contact row
- Contact history count
- Next outreach date
- Alert recipient and CC

## Store List Filters

For each filter, compare count and first 20 stores sorted by V1 selector priority:

- Balaclava Sales range
- Store Revenue range
- Top 30 Pareto Stores
- Pareto 80% revenue set
- Lapsed priority
- Open lane priority
- Recent order date range
- Brand placement
- Region/rep
- Proximity from Tacoma
- Search by store name
- Search by license

## Map

Compare:

- Load Map count
- Mapped count
- Unmapped count
- All Retailers count
- All Other Retailers count
- Marker colors by designation
- Route candidate count
- Top 10 route candidates

## Orders And Goals

Compare:

- Brand summary revenue
- Brand summary units
- Recent order activity rows
- Released/manifests totals where applicable
- Monthly goal actuals
- Weekly goal actuals
- EOM pace
- Weekly pace
- MoM current/previous totals
