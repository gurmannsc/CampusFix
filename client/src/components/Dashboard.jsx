// The administrator's dashboard (US-10): resolution time, open vs closed, workload, deadline breaches and
// ratings, with filters for category, block and date range. All numbers come from GET /api/dashboard
// (ReportService); the tables under the charts show the same data in text.
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import { Message } from './Badges.jsx';

// Colours chosen to stay apart for colour-blind readers (blue / orange / grey), never red-green only.
const BLUE = '#1f4f99';
const ORANGE = '#d98a00';
const GREY = '#8a94a6';
const TEAL = '#0b7f8f';

const hoursText = (h) => (h == null ? '—' : h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`);
const pct = (p) => (p == null ? '—' : `${p}%`);

export default function Dashboard() {
  const [filters, setFilters] = useState({ category: '', block: '', from: '', to: '' });
  const categories = useLoad(() => api.get('/categories'), []);
  const locations = useLoad(() => api.get('/locations'), []);

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data, error, loading } = useLoad(() => api.get(`/dashboard${query ? `?${query}` : ''}`), [query]);

  const set = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));
  const blocks = [...new Set((locations.data?.locations ?? []).map((l) => l.block))];
  const dateOrderWrong = filters.from && filters.to && filters.from > filters.to;
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <>
      <section className="card filters" aria-label="Dashboard filters">
        <label>Category
          <select value={filters.category} onChange={set('category')}>
            <option value="">All categories</option>
            {(categories.data?.categories ?? []).map((c) => <option key={c.categoryId} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label>Block
          <select value={filters.block} onChange={set('block')}>
            <option value="">All blocks</option>
            {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>Reported from
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
        </label>
        <label>Reported until
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
        </label>
        <button type="button" disabled={!anyFilter} onClick={() => setFilters({ category: '', block: '', from: '', to: '' })}>Clear filters</button>
        <p className="muted small summary">
          Complaints are counted by the day they were reported (whole days, UTC).
          {dateOrderWrong && ' The start date is after the end date, so nothing can match.'}
        </p>
      </section>

      <Message>{error?.message}</Message>
      {loading && !data && <p className="muted">Loading…</p>}
      {data && <DashboardBody data={data} refreshing={loading} />}
    </>
  );
}

function DashboardBody({ data, refreshing }) {
  const { summary, byCategory, workload, ratings, byStatus } = data;

  if (summary.total === 0) {
    return <section className="card"><p>No complaints match these filters.</p></section>;
  }

  const closedChart = [
    { name: 'Open', value: summary.open, fill: ORANGE },
    { name: 'Closed', value: summary.closed, fill: BLUE },
    { name: 'Invalid', value: summary.invalid, fill: GREY },
  ].filter((d) => d.value > 0);
  const resolutionChart = byCategory.filter((c) => c.avgResolutionHours != null).map((c) => ({ name: c.name, hours: c.avgResolutionHours }));
  const breachChart = byCategory.filter((c) => c.breachPercent != null).map((c) => ({ name: c.name, percent: c.breachPercent }));
  const workloadChart = workload.map((w) => ({ name: w.name, open: w.openAssignments, completed: w.completed }));
  const ratingChart = [1, 2, 3, 4, 5].map((n) => ({ name: `${n} ★`, count: ratings.distribution[n] }));

  return (
    <div className={refreshing ? 'dash refreshing' : 'dash'} aria-busy={refreshing}>
      <section className="tiles" aria-label="Key figures">
        <Tile label="Complaints" value={summary.total} detail={`${summary.open} open · ${summary.closed} closed${summary.invalid ? ` · ${summary.invalid} invalid` : ''}`} />
        <Tile label="Average resolution time" value={hoursText(summary.avgResolutionHours)} detail={`${summary.resolvedCount} resolved complaints`} />
        <Tile label="Deadline breaches" value={pct(summary.breachPercent)} detail={summary.breachEligible ? `${summary.breached} of ${summary.breachEligible} complaints` : 'nothing finished or late yet'} />
        <Tile label="Average rating" value={summary.avgRating == null ? '—' : `${summary.avgRating} / 5`} detail={`${summary.ratingCount} rating${summary.ratingCount === 1 ? '' : 's'}`} />
      </section>

      <div className="charts">
        <ChartCard title="Open vs closed" summary={closedChart.map((d) => `${d.name} ${d.value}`).join(', ')}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={closedChart} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} label={({ name, value }) => `${name} ${value}`}>
                {closedChart.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average resolution time by category (hours)" summary={resolutionChart.map((d) => `${d.name} ${d.hours} h`).join(', ')}>
          <BarsOrNothing data={resolutionChart}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={resolutionChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={60} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(v) => [`${v} h`, 'Average']} />
                <Bar dataKey="hours" name="Hours" fill={BLUE} />
              </BarChart>
            </ResponsiveContainer>
          </BarsOrNothing>
        </ChartCard>

        <ChartCard title="Deadline breaches by category (%)" summary={breachChart.map((d) => `${d.name} ${d.percent}%`).join(', ')}>
          <BarsOrNothing data={breachChart}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={breachChart} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={60} tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`, 'Breached']} />
                <Bar dataKey="percent" name="Breached %" fill={ORANGE} />
              </BarChart>
            </ResponsiveContainer>
          </BarsOrNothing>
        </ChartCard>

        <ChartCard title="Ratings" summary={`average ${ratings.average ?? 'none'}, ${ratings.count} ratings`}>
          <BarsOrNothing data={ratings.count ? ratingChart : []} empty="No ratings yet.">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ratingChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="Ratings" fill={TEAL} />
              </BarChart>
            </ResponsiveContainer>
          </BarsOrNothing>
        </ChartCard>

        <ChartCard wide title="Workload per staff member" summary={workloadChart.map((d) => `${d.name}: ${d.open} open, ${d.completed} completed`).join('; ')}>
          <ResponsiveContainer width="100%" height={Math.max(260, workloadChart.length * 34 + 60)}>
            <BarChart data={workloadChart} layout="vertical" margin={{ top: 8, right: 16, left: 20, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="open" name="Open assignments" stackId="w" fill={ORANGE} />
              <Bar dataKey="completed" name="Completed" stackId="w" fill={BLUE} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <section className="card">
        <h2>By category</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Category</th><th>Complaints</th><th>Open</th><th>Closed</th><th>Avg resolution</th><th>Deadline breaches</th><th>Avg rating</th></tr>
            </thead>
            <tbody>
              {byCategory.map((c) => (
                <tr key={c.categoryId}>
                  <td>{c.name}{c.type === 'SERVICE' && <span className="muted small"> (service)</span>}</td>
                  <td>{c.total}</td><td>{c.open}</td><td>{c.closed}</td>
                  <td>{hoursText(c.avgResolutionHours)}</td>
                  <td>{pct(c.breachPercent)} <span className="muted small">{c.breachEligible ? `(${c.breached}/${c.breachEligible})` : ''}</span></td>
                  <td>{c.avgRating ?? '—'} <span className="muted small">{c.ratingCount ? `(${c.ratingCount})` : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Workload and service quality per person</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Trade</th><th>Open assignments</th><th>Completed</th><th>All assigned</th><th>Avg rating</th></tr></thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.userId}>
                  <td>{w.name}</td><td>{w.trade ?? <span className="muted">Administrator</span>}</td>
                  <td>{w.openAssignments}</td><td>{w.completed}</td><td>{w.totalAssigned}</td>
                  <td>{w.avgRating ?? '—'} <span className="muted small">{w.ratingCount ? `(${w.ratingCount})` : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Status counts: {Object.entries(byStatus).filter(([, n]) => n > 0).map(([s, n]) => `${s.replace('_', ' ').toLowerCase()} ${n}`).join(' · ')}
        </p>
        <details className="small">
          <summary>How the figures are calculated</summary>
          <ul>
            <li><strong>Resolution time</strong>: from reporting to the final resolution, for resolved and closed complaints.</li>
            <li><strong>Deadline breach</strong>: a complaint that was escalated, resolved after its deadline, or is still open past its deadline. The percentage is out of finished or late complaints.</li>
            <li><strong>Open assignments</strong>: complaints currently assigned, in progress, on hold or escalated.</li>
            <li><strong>Rating</strong>: average of the 1 to 5 ratings reporters gave when confirming a fix.</li>
          </ul>
        </details>
      </section>
    </div>
  );
}

const Tile = ({ label, value, detail }) => (
  <div className="tile">
    <div className="tile-label">{label}</div>
    <div className="tile-value">{value}</div>
    <div className="muted small">{detail}</div>
  </div>
);

// A chart with a text summary for screen readers (the charts themselves are not readable by them).
function ChartCard({ title, summary, wide, children }) {
  return (
    <section className={wide ? 'card chart wide' : 'card chart'}>
      <h2>{title}</h2>
      <div role="img" aria-label={`${title}: ${summary || 'no data'}`}>{children}</div>
    </section>
  );
}

const BarsOrNothing = ({ data, empty = 'Nothing to show for these filters.', children }) => (data.length ? children : <p className="muted pad">{empty}</p>);
