"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Check, Map, SlidersHorizontal } from "lucide-react";
import type { DashboardSnapshot } from "@/lib/dashboard-data";
import { TERRITORY_MAP_COLORS, formatUsd, type StoreRollup } from "@/lib/rules";

type StoreDashboardProps = {
  snapshot: DashboardSnapshot;
};

type DetailTab = "contact" | "orders" | "buyer" | "history" | "samples";
type SortKey = "store" | "designation" | "balaclava" | "storeRevenue" | "rep" | "log";
type SortDirection = "asc" | "desc";

type BuyerContactPatch = {
  contactName: string | null;
  phoneNumber: string | null;
  email: string | null;
};

const detailTabs: { id: DetailTab; label: string }[] = [
  { id: "contact", label: "Contact" },
  { id: "orders", label: "Orders" },
  { id: "buyer", label: "Buyer" },
  { id: "history", label: "History" },
  { id: "samples", label: "Samples" }
];

const sortableColumns: { key: SortKey; label: string; width?: string }[] = [
  { key: "store", label: "Store", width: "34%" },
  { key: "designation", label: "Designation" },
  { key: "balaclava", label: "Balaclava" },
  { key: "storeRevenue", label: "Store Revenue" },
  { key: "rep", label: "Rep" },
  { key: "log", label: "Log" }
];

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

function storeKey(store: StoreRollup) {
  return store.storeId || store.licenseKey || store.license;
}

function textSortValue(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function sortValueForStore(store: StoreRollup, sortKey: SortKey) {
  if (sortKey === "store") {
    return `${textSortValue(store.storeName)} ${textSortValue(store.license)}`;
  }
  if (sortKey === "designation") {
    return textSortValue(store.mapCategory);
  }
  if (sortKey === "balaclava") {
    return store.latestMonthRevenue;
  }
  if (sortKey === "storeRevenue") {
    return store.marketSalesLastMonth;
  }
  if (sortKey === "rep") {
    return textSortValue(store.territoryRep);
  }
  return store.hasContactEver ? 1 : 0;
}

function sortStores(stores: StoreRollup[], sortKey: SortKey, direction: SortDirection) {
  const directionMultiplier = direction === "asc" ? 1 : -1;

  return [...stores].sort((left, right) => {
    const leftValue = sortValueForStore(left, sortKey);
    const rightValue = sortValueForStore(right, sortKey);
    let comparison = 0;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    if (comparison === 0) {
      comparison = textSortValue(left.storeName).localeCompare(textSortValue(right.storeName), undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    return comparison * directionMultiplier;
  });
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value === null || value === undefined || value === "" ? "-" : value}</strong>
    </div>
  );
}

function StoreDetailSummary({ store }: { store: StoreRollup }) {
  const location = [store.city, store.state, store.zip].filter(Boolean).join(", ");

  return (
    <div className="detail-summary">
      <div className="detail-designation">
        <span
          className="dot"
          style={{
            background: TERRITORY_MAP_COLORS[store.mapCategory] ?? "var(--muted)"
          }}
        />
        <strong>{store.mapCategory}</strong>
      </div>
      <div className="detail-list compact">
        <DetailRow label="License" value={store.license} />
        <DetailRow label="Rep" value={store.territoryRep} />
        <DetailRow label="Location" value={location} />
        <DetailRow label="Latest Balaclava" value={formatUsd(store.latestMonthRevenue)} />
        <DetailRow label="Market sales" value={formatUsd(store.marketSalesLastMonth)} />
        <DetailRow label="Orders" value={store.orders.toLocaleString()} />
        <DetailRow label="Log entries" value={store.contactLogCount.toLocaleString()} />
      </div>
    </div>
  );
}

function StoreDetailHero({ store }: { store: StoreRollup }) {
  const location = [store.city, store.state, store.zip].filter(Boolean).join(", ");

  return (
    <div className="detail-hero">
      <div className="detail-hero-line">
        <span
          className="dot"
          style={{
            background: TERRITORY_MAP_COLORS[store.mapCategory] ?? "var(--muted)"
          }}
        />
        <strong>{store.mapCategory}</strong>
      </div>
      <div className="detail-hero-grid">
        <span>License</span>
        <strong>{store.license || "-"}</strong>
        <span>Rep</span>
        <strong>{store.territoryRep || "-"}</strong>
        <span>Location</span>
        <strong>{location || "-"}</strong>
        <span>Balaclava</span>
        <strong>{formatUsd(store.latestMonthRevenue)}</strong>
        <span>Market</span>
        <strong>{formatUsd(store.marketSalesLastMonth)}</strong>
      </div>
    </div>
  );
}

function BuyerEditor({
  store,
  onSaved
}: {
  store: StoreRollup;
  onSaved: (storeId: string, buyer: BuyerContactPatch) => void;
}) {
  const [contactName, setContactName] = useState(store.contactName ?? "");
  const [phoneNumber, setPhoneNumber] = useState(store.phoneNumber ?? "");
  const [email, setEmail] = useState(store.email ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setContactName(store.contactName ?? "");
    setPhoneNumber(store.phoneNumber ?? "");
    setEmail(store.email ?? "");
    setMessage("");
  }, [store.contactName, store.email, store.phoneNumber, store.storeId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!store.storeId) {
      setMessage("This store is missing a Supabase store id.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/store-contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          storeId: store.storeId,
          contactName,
          phoneNumber,
          email
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not save buyer contact.");
      }

      onSaved(result.storeId, {
        contactName: result.contactName,
        phoneNumber: result.phoneNumber,
        email: result.email
      });
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save buyer contact.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="detail-stack" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Buyer</label>
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            placeholder="Buyer name"
          />
        </div>
        <div className="field">
          <label>Phone</label>
          <input
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            placeholder="Phone number"
            type="tel"
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            type="email"
          />
        </div>
      </div>
      <button className="primary-button detail-save-button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Buyer"}
      </button>
      {message ? <div className="status-message">{message}</div> : null}
      <div className="detail-list">
        <DetailRow label="License" value={store.license} />
        <DetailRow label="Rep" value={store.territoryRep} />
        <DetailRow label="County" value={store.county} />
        <DetailRow label="Location" value={[store.city, store.state, store.zip].filter(Boolean).join(", ")} />
      </div>
    </form>
  );
}

function StoreDetailContent({
  activeTab,
  store,
  onBuyerSaved
}: {
  activeTab: DetailTab;
  store: StoreRollup;
  onBuyerSaved: (storeId: string, buyer: BuyerContactPatch) => void;
}) {
  if (activeTab === "orders") {
    return (
      <div className="detail-stack">
        <div className="metrics detail-metrics">
          <DetailStat label="Orders" value={store.orders.toLocaleString()} />
          <DetailStat label="Brand Revenue" value={formatUsd(store.brandRevenue)} />
        </div>
        <div className="detail-list">
          <DetailRow label="Last order" value={formatDate(store.lastOrderAt)} />
          <DetailRow label="Order #" value={store.lastOrderNumber} />
          <DetailRow label="K. Savage last order" value={formatDate(store.kSavageLastOrderAt)} />
          <DetailRow label="K. Savage history" value={formatUsd(store.kSavageHistoricalRevenue)} />
          <DetailRow label="Mayfield active" value={formatUsd(store.mayfieldActiveRevenue)} />
          <DetailRow label="Leisure Land active" value={formatUsd(store.leisureLandActiveRevenue)} />
        </div>
      </div>
    );
  }

  if (activeTab === "buyer") {
    return <BuyerEditor store={store} onSaved={onBuyerSaved} />;
  }

  if (activeTab === "history") {
    return (
      <div className="detail-stack">
        <div className="detail-tabs">
          <CheckState active={store.hasContactEver} label="Any log" />
          <CheckState active={store.hasContactThisMonth} label="This month" />
          <CheckState active={store.hasContactThisWeek} label="This week" />
        </div>
        <div className="detail-list">
          <DetailRow label="Log count" value={store.contactLogCount.toLocaleString()} />
          <DetailRow label="Last contact" value={formatDate(store.lastContactDate)} />
          <DetailRow label="Method" value={store.lastContactMethod} />
          <DetailRow label="Person" value={store.lastContactPerson} />
        </div>
        {store.lastContactNotes ? <p className="detail-note">{store.lastContactNotes}</p> : null}
      </div>
    );
  }

  if (activeTab === "samples") {
    return (
      <div className="detail-stack">
        <div className="metrics detail-metrics">
          <DetailStat label="Sample Drops" value={store.sampleDropCount.toLocaleString()} />
          <DetailStat label="Latest Drop" value={formatDate(store.latestSampleDate)} />
        </div>
        <div className="detail-list">
          <DetailRow label="Brand" value={store.latestSampleBrand} />
          <DetailRow label="Product" value={store.latestSampleProduct} />
        </div>
      </div>
    );
  }

  return (
    <div className="detail-stack">
      <div className="metrics detail-metrics">
        <DetailStat label="Latest Month" value={formatUsd(store.latestMonthRevenue)} />
        <DetailStat label="Market Sales" value={formatUsd(store.marketSalesLastMonth)} />
      </div>
      <div className="detail-tabs">
        <CheckState active={store.hasContactEver} label="Any log" />
        <CheckState active={store.hasContactThisMonth} label="This month" />
        <CheckState active={store.hasContactThisWeek} label="This week" />
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
    </div>
  );
}

export function StoreDashboard({ snapshot }: StoreDashboardProps) {
  const [stores, setStores] = useState(snapshot.stores);
  const [storeQuery, setStoreQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DetailTab>("contact");
  const [sortKey, setSortKey] = useState<SortKey>("storeRevenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedStoreKey, setSelectedStoreKey] = useState(() => (
    snapshot.stores[0] ? storeKey(snapshot.stores[0]) : ""
  ));
  const normalizedStoreQuery = storeQuery.trim().toLowerCase();
  const filteredStores = useMemo(() => {
    if (!normalizedStoreQuery) {
      return stores;
    }
    return stores.filter((store) => (
      store.storeName.toLowerCase().includes(normalizedStoreQuery) ||
      store.license.toLowerCase().includes(normalizedStoreQuery) ||
      store.licenseKey.toLowerCase().includes(normalizedStoreQuery)
    ));
  }, [normalizedStoreQuery, stores]);
  const sortedStores = useMemo(
    () => sortStores(filteredStores, sortKey, sortDirection),
    [filteredStores, sortDirection, sortKey]
  );
  const metrics = useMemo(() => summarizeStores(sortedStores), [sortedStores]);
  const selectedStore = sortedStores.find((store) => storeKey(store) === selectedStoreKey) || sortedStores[0];
  const rowMeta = normalizedStoreQuery
    ? `${sortedStores.length.toLocaleString()} of ${stores.length.toLocaleString()} rows`
    : `${sortedStores.length.toLocaleString()} rows`;

  useEffect(() => {
    setStores(snapshot.stores);
  }, [snapshot.stores]);

  useEffect(() => {
    if (!sortedStores.length) {
      setSelectedStoreKey("");
      return;
    }
    if (!sortedStores.some((store) => storeKey(store) === selectedStoreKey)) {
      setSelectedStoreKey(storeKey(sortedStores[0]));
    }
  }, [selectedStoreKey, sortedStores]);

  function handleBuyerSaved(storeId: string, buyer: BuyerContactPatch) {
    setStores((currentStores) => currentStores.map((store) => (
      store.storeId === storeId ? { ...store, ...buyer } : store
    )));
  }

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "balaclava" || nextSortKey === "storeRevenue" || nextSortKey === "log" ? "desc" : "asc"
    );
  }

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
                  {sortableColumns.map((column) => {
                    const isActive = column.key === sortKey;
                    return (
                      <th
                        key={column.key}
                        aria-sort={isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                        style={column.width ? { width: column.width } : undefined}
                      >
                        <button
                          className="sort-header"
                          type="button"
                          onClick={() => handleSort(column.key)}
                        >
                          <span>{column.label}</span>
                          <span aria-hidden="true" className="sort-indicator">
                            {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedStores.map((store) => (
                  <tr
                    key={storeKey(store)}
                    className={selectedStore && storeKey(store) === storeKey(selectedStore) ? "is-selected" : ""}
                    tabIndex={0}
                    onClick={() => setSelectedStoreKey(storeKey(store))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedStoreKey(storeKey(store));
                      }
                    }}
                  >
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
                {!sortedStores.length ? (
                  <tr>
                    <td colSpan={6}>No stores match that search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <aside className="panel store-detail">
            <div className="detail-title">
              <h3>
                <span>{selectedStore?.storeName ?? "Select a store"}</span>
                {selectedStore ? (
                  <small>
                    {selectedStore.license || "-"} · {selectedStore.mapCategory} · Balaclava{" "}
                    {formatUsd(selectedStore.latestMonthRevenue)} · Market{" "}
                    {formatUsd(selectedStore.marketSalesLastMonth)}
                  </small>
                ) : null}
              </h3>
              <span className="caption">
                {selectedStore ? `${selectedStore.license} · ${selectedStore.city ?? ""}` : "Store detail drawer"}
              </span>
              {selectedStore ? <StoreDetailHero store={selectedStore} /> : null}
            </div>
            {selectedStore ? <StoreDetailSummary store={selectedStore} /> : null}
            <div className="detail-tabs" role="tablist" aria-label="Store detail sections">
              {detailTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {selectedStore ? (
              <StoreDetailContent
                activeTab={activeTab}
                store={selectedStore}
                onBuyerSaved={handleBuyerSaved}
              />
            ) : null}
          </aside>
        </section>
      </main>
    </div>
  );
}
