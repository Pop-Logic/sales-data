"use client";

import { useMemo, useState } from "react";
import { Check, Map, SlidersHorizontal } from "lucide-react";
import type { DashboardSnapshot } from "@/lib/dashboard-data";
import { TERRITORY_MAP_COLORS, formatUsd, type StoreRollup } from "@/lib/rules";

type StoreDashboardProps = {
  snapshot: DashboardSnapshot;
};

function CheckState({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="tag" title={label}>
      <Check size={14} color={active ? "var(--green)" : "var(--muted)"} />
      {label}
    </span>
  );
}

function summarizeStores(stores: StoreRollup[]) {
  return {
    totalRetailers: stores.length,
    mappedStores: stores.filter((store) => (
      Number.isFinite(store.latitude) && Number.isFinite(store.longitude)
    )).length,
    lapsedPriority: stores.filter((store) => store.mapCategory.startsWith("K Savage Lapsed")).length,
    openLanePriority: stores.filter((store) => store.mapCategory.startsWith("Open Lane")).length,
    pitchMayfield: stores.filter((store) => store.mapCategory === "Pitch Mayfield").length
  };
}

export function StoreDashboard({ snapshot }: StoreDashboardProps) {
  const [storeQuery, setStoreQuery] = useState("");
  const normalizedStoreQuery = storeQuery.trim().toLowerCase();
  const filteredStores = useMemo(() => {
    if (!normalizedStoreQuery) {
      return snapshot.stores;
    }
    return snapshot.stores.filter((store) => (
      store.storeName.toLowerCase().includes(normalizedStoreQuery) ||
      store.license.toLowerCase().includes(normalizedStoreQuery) ||
      store.licenseKey.toLowerCase().includes(normalizedStoreQuery)
    ));
  }, [normalizedStoreQuery, snapshot.stores]);
  const metrics = useMemo(() => summarizeStores(filteredStores), [filteredStores]);
  const firstStore = filteredStores[0];
  const rowMeta = normalizedStoreQuery
    ? `${filteredStores.length.toLocaleString()} of ${snapshot.stores.length.toLocaleString()} rows`
    : `${filteredStores.length.toLocaleString()} rows`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="RODYO" />
          <span>Balaclava store operations</span>
        </div>
        <nav className="nav" aria-label="Main navigation">
          <a className="active" href="/">
            Stores
          </a>
          <a href="/">Map</a>
          <a href="/">Orders</a>
          <a href="/">Goals</a>
          <a href="/">Sync</a>
        </nav>
      </aside>

      <main className="main">
        <section className="toolbar">
          <div className="toolbar-title">
            <div>
              <h2>Stores</h2>
              <div className="caption">
                {snapshot.source === "demo"
                  ? "Demo shell. Connect Supabase to load live CRM data."
                  : "Live Supabase data"}
              </div>
            </div>
            <button className="primary-button" type="button">
              <Map size={16} /> Launch Map
            </button>
          </div>

          <form className="filters" aria-label="Store filters" onSubmit={(event) => event.preventDefault()}>
            <div className="field store-filter-field">
              <label>Stores</label>
              <input
                type="search"
                value={storeQuery}
                onChange={(event) => setStoreQuery(event.target.value)}
                placeholder="Name or license"
              />
            </div>
            <div className="field">
              <label>Balaclava Sales</label>
              <select defaultValue="all">
                <option value="all">Any range</option>
                <option value="1000">$1k+</option>
                <option value="5000">$5k+</option>
              </select>
            </div>
            <div className="field">
              <label>Store Revenue</label>
              <select defaultValue="all">
                <option value="all">Any range</option>
                <option value="50000">$50k+</option>
                <option value="100000">$100k+</option>
              </select>
            </div>
            <div className="field">
              <label>Pareto</label>
              <select defaultValue="all">
                <option value="all">All stores</option>
                <option value="top30">Top 30</option>
                <option value="eighty">80% revenue set</option>
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select defaultValue="all">
                <option value="all">All priorities</option>
                <option value="lapsed">Lapsed</option>
                <option value="open-lane">Open lane</option>
              </select>
            </div>
            <div className="field">
              <label>Region</label>
              <select defaultValue="all">
                <option value="all">All regions</option>
              </select>
            </div>
            <button className="primary-button" type="button">
              <SlidersHorizontal size={16} /> Apply
            </button>
          </form>
        </section>

        <section className="metrics">
          <div className="metric">
            <div className="metric-label">Retailers</div>
            <div className="metric-value">{metrics.totalRetailers.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Mapped</div>
            <div className="metric-value">{metrics.mappedStores.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Lapsed Priority</div>
            <div className="metric-value">{metrics.lapsedPriority.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Open Lane</div>
            <div className="metric-value">{metrics.openLanePriority.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Pitch Mayfield</div>
            <div className="metric-value">{metrics.pitchMayfield.toLocaleString()}</div>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h3>Filtered Stores</h3>
              <span className="table-meta">{rowMeta}</span>
            </div>
            <table className="store-table">
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>Store</th>
                  <th>Designation</th>
                  <th>Balaclava</th>
                  <th>Store Revenue</th>
                  <th>Rep</th>
                  <th>Log</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.map((store) => (
                  <tr key={store.licenseKey || store.license}>
                    <td>
                      <div className="store-name">{store.storeName}</div>
                      <div className="store-subtext">
                        {store.license} · {store.city || "No city"} {store.zip || ""}
                      </div>
                    </td>
                    <td>
                      <span className="tag">
                        <span
                          className="dot"
                          style={{
                            background: TERRITORY_MAP_COLORS[store.mapCategory] ?? "var(--muted)"
                          }}
                        />
                        {store.mapCategory}
                      </span>
                    </td>
                    <td>{formatUsd(store.latestMonthRevenue)}</td>
                    <td>{formatUsd(store.marketSalesLastMonth)}</td>
                    <td>{store.territoryRep || "-"}</td>
                    <td>{store.hasContactEver ? "✅" : ""}</td>
                  </tr>
                ))}
                {!filteredStores.length ? (
                  <tr>
                    <td colSpan={6}>No stores match that search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <aside className="panel store-detail">
            <div className="detail-title">
              <h3>{firstStore?.storeName ?? "Select a store"}</h3>
              <span className="caption">
                {firstStore ? `${firstStore.license} · ${firstStore.city ?? ""}` : "Store detail drawer"}
              </span>
            </div>
            <div className="detail-tabs">
              <button className="active" type="button">
                Contact
              </button>
              <button type="button">Orders</button>
              <button type="button">Buyer</button>
              <button type="button">History</button>
              <button type="button">Samples</button>
            </div>
            {firstStore ? (
              <>
                <div className="metrics" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", margin: 0 }}>
                  <div className="metric">
                    <div className="metric-label">Latest Month</div>
                    <div className="metric-value">{formatUsd(firstStore.latestMonthRevenue)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Market Sales</div>
                    <div className="metric-value">{formatUsd(firstStore.marketSalesLastMonth)}</div>
                  </div>
                </div>
                <div className="detail-tabs">
                  <CheckState active={firstStore.hasContactEver} label="Any log" />
                  <CheckState active={firstStore.hasContactThisMonth} label="This month" />
                  <CheckState active={firstStore.hasContactThisWeek} label="This week" />
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>Contact method</label>
                    <select defaultValue="">
                      <option value="">Select</option>
                      <option>In-person</option>
                      <option>Phone</option>
                      <option>Email</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Initials</label>
                    <select defaultValue="">
                      <option value="">Select</option>
                      <option>DK</option>
                      <option>CH</option>
                    </select>
                  </div>
                </div>
                <button className="primary-button" type="button">
                  Save Contact Log
                </button>
              </>
            ) : null}
          </aside>
        </section>
      </main>
    </div>
  );
}
