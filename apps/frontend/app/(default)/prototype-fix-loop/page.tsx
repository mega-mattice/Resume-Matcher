'use client';

// PROTOTYPE (throwaway): shared ATS fix-loop, 3 variants, ?variant=A|B|C.
// Stub data, in-memory state, no backend. Question: layout/order/attest/undo/delta behavior.
// Wayfinder ticket: "Prototype: shared fix-loop component". Delete after the decision.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

type Sub =
  | 'keyword_match'
  | 'skills_coverage'
  | 'title_match'
  | 'section_completeness'
  | 'date_consistency';
const WEIGHT: Record<Sub, number> = {
  keyword_match: 40,
  skills_coverage: 20,
  title_match: 15,
  section_completeness: 15,
  date_consistency: 10,
};
const LABEL: Record<Sub, string> = {
  keyword_match: 'Keyword match',
  skills_coverage: 'Skills coverage',
  title_match: 'Title match',
  section_completeness: 'Sections',
  date_consistency: 'Dates',
};
const START: Record<Sub, number> = {
  keyword_match: 55,
  skills_coverage: 60,
  title_match: 0,
  section_completeness: 70,
  date_consistency: 50,
};

interface Fix {
  id: string;
  sub: Sub;
  title: string;
  detail: string;
  gain: number; // sub-score points (0-100)
  kind: 'one-click' | 'attest' | 'input';
  attest?: string;
  inputLabel?: string;
}
const FIXES: Fix[] = [
  {
    id: 'kw-master',
    sub: 'keyword_match',
    title: 'Work in 3 keywords from your master',
    detail: 'Kubernetes, CI/CD, observability: already in your master resume.',
    gain: 20,
    kind: 'one-click',
  },
  {
    id: 'title',
    sub: 'title_match',
    title: 'Set headline to "Senior Platform Engineer"',
    detail: 'Posting title. Replaces current headline "Software Engineer".',
    gain: 100,
    kind: 'attest',
    attest: 'This title honestly describes my role.',
  },
  {
    id: 'kw-attest',
    sub: 'keyword_match',
    title: 'Add "Terraform" (not on master)',
    detail: 'Job asks for it; your master never mentions it.',
    gain: 15,
    kind: 'attest',
    attest: 'I have used Terraform. Also add to master resume.',
  },
  {
    id: 'skills',
    sub: 'skills_coverage',
    title: 'Add 3 skills from master to Skills',
    detail: 'Go, Docker, AWS appear in the JD and your master.',
    gain: 25,
    kind: 'one-click',
  },
  {
    id: 'dates',
    sub: 'date_consistency',
    title: 'Normalize dates to "Mon YYYY"',
    detail: '3 entries mix "2021", "03/2020" and "Mar 2019".',
    gain: 50,
    kind: 'one-click',
  },
  {
    id: 'sections',
    sub: 'section_completeness',
    title: 'Unhide Projects section',
    detail: 'Hidden section holds 2 entries.',
    gain: 15,
    kind: 'one-click',
  },
  {
    id: 'summary',
    sub: 'section_completeness',
    title: 'Add a summary',
    detail: 'No summary on this resume.',
    gain: 15,
    kind: 'input',
    inputLabel: 'Write 1-2 sentences',
  },
];

const overall = (s: Record<Sub, number>) =>
  (Object.keys(WEIGHT) as Sub[]).reduce((a, k) => a + (WEIGHT[k] * s[k]) / 100, 0);
const pts = (f: Fix) => (WEIGHT[f.sub] * f.gain) / 100;
const bandText = (v: number) =>
  v >= 80 ? 'text-success' : v >= 60 ? 'text-warning-text' : 'text-destructive';

function useLoop() {
  const [applied, setApplied] = useState<string[]>([]); // ordered, undo stack
  const [target, setTarget] = useState(80);
  const subs = useMemo(() => {
    const s = { ...START };
    for (const id of applied) {
      const f = FIXES.find((x) => x.id === id)!;
      s[f.sub] = Math.min(100, s[f.sub] + f.gain);
    }
    return s;
  }, [applied]);
  const score = overall(subs);
  const remaining = FIXES.filter((f) => !applied.includes(f.id)).sort((a, b) => pts(b) - pts(a));
  const apply = useCallback((id: string) => setApplied((a) => [...a, id]), []);
  const undo = useCallback((id: string) => setApplied((a) => a.filter((x) => x !== id)), []);
  const undoLast = useCallback(() => setApplied((a) => a.slice(0, -1)), []);
  const best = score + remaining.reduce((a, f) => a + pts(f), 0);
  return {
    applied,
    target,
    setTarget,
    subs,
    score,
    remaining,
    apply,
    undo,
    undoLast,
    best,
    base: overall(START),
  };
}
type Loop = ReturnType<typeof useLoop>;

const sw = 'border border-ink bg-white shadow-sw-nested';
const mono = 'font-mono text-xs uppercase tracking-wider';
const btn =
  'border border-ink bg-white px-3 py-1.5 font-mono text-xs uppercase tracking-wider hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const btnPrimary =
  'border border-ink bg-primary px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-white hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function Gap({ L }: { L: Loop }) {
  const gap = Math.max(0, L.target - L.score);
  const reachable = L.best >= L.target;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-4">
      <div>
        <p className={mono + ' text-steel'}>ATS score</p>
        <p className="flex items-end gap-2">
          <span className={cn('font-mono text-4xl font-bold tabular-nums', bandText(L.score))}>
            {L.score.toFixed(1)}
          </span>
          <span className="mb-1 font-mono text-sm tabular-nums text-ink-soft">
            was {L.base.toFixed(1)} · {L.score >= L.base ? '+' : ''}
            {(L.score - L.base).toFixed(1)}
          </span>
        </p>
      </div>
      <div className="text-right">
        <label className={mono + ' text-steel'}>
          Target{' '}
          <input
            type="number"
            min={50}
            max={100}
            value={L.target}
            onChange={(e) => L.setTarget(Number(e.target.value) || 80)}
            className="ml-1 w-14 border border-ink bg-white px-1 py-0.5 text-right font-mono text-sm text-ink"
          />
        </label>
        <p className="mt-1 font-mono text-sm tabular-nums text-ink-soft">
          {L.score >= L.target
            ? 'Target reached'
            : reachable
              ? `${gap.toFixed(1)} pts to go`
              : `Best reachable: ${L.best.toFixed(1)}`}
        </p>
      </div>
      <div className="relative h-3 w-full border border-ink bg-white">
        <div className="h-full bg-primary" style={{ width: `${L.score}%` }} />
        <div
          className="absolute inset-y-[-4px] w-0.5 bg-ink"
          style={{ left: `${L.target}%` }}
          title="target"
        />
      </div>
    </div>
  );
}

/** Attest/input gate shared by all variants. */
function FixAction({ f, L, compact }: { f: Fix; L: Loop; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  const [text, setText] = useState('');
  if (f.kind === 'one-click')
    return (
      <button className={btnPrimary} onClick={() => L.apply(f.id)}>
        Fix +{pts(f).toFixed(1)}
      </button>
    );
  if (!open)
    return (
      <button className={btn} onClick={() => setOpen(true)}>
        {f.kind === 'attest' ? 'Review' : 'Add'} +{pts(f).toFixed(1)}
      </button>
    );
  return (
    <div className={cn('space-y-2 border border-ink bg-paper p-3', compact ? 'w-full' : 'mt-2')}>
      {f.kind === 'attest' ? (
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={ok}
            onChange={(e) => setOk(e.target.checked)}
            className="mt-1"
          />
          {f.attest}
        </label>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
          placeholder={f.inputLabel}
          className="w-full border border-ink bg-white p-2 text-sm"
          rows={2}
        />
      )}
      <div className="flex gap-2">
        <button
          className={btnPrimary}
          disabled={f.kind === 'attest' ? !ok : text.trim().length < 10}
          onClick={() => L.apply(f.id)}
          style={{ opacity: (f.kind === 'attest' ? ok : text.trim().length >= 10) ? 1 : 0.4 }}
        >
          Apply
        </button>
        <button className={btn} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Done({ L }: { L: Loop }) {
  if (!L.applied.length) return null;
  return (
    <div className="mt-6">
      <p className={mono + ' mb-2 text-steel'}>Applied ({L.applied.length})</p>
      <ul className="space-y-1">
        {L.applied.map((id) => {
          const f = FIXES.find((x) => x.id === id)!;
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-2 border border-success bg-success-tint px-3 py-1.5 text-sm"
            >
              <span>{f.title}</span>
              <span className="flex items-center gap-3 font-mono text-xs">
                <span className="text-success">+{pts(f).toFixed(1)}</span>
                <button className="underline" onClick={() => L.undo(id)}>
                  Undo
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A: ranked checklist, biggest win first. */
function VariantA({ L }: { L: Loop }) {
  return (
    <div className={cn(sw, 'space-y-4 p-6')}>
      <Gap L={L} />
      <p className={mono + ' text-steel'}>Fixes · biggest first</p>
      <ol className="space-y-2">
        {L.remaining.map((f, i) => (
          <li key={f.id} className="border border-ink bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-sm text-steel">{i + 1}</span>
                <div>
                  <p className="font-serif text-base font-bold">{f.title}</p>
                  <p className="text-sm text-ink-soft">{f.detail}</p>
                  <p className={mono + ' mt-1 text-steel'}>{LABEL[f.sub]}</p>
                </div>
              </div>
              <FixAction f={f} L={L} compact />
            </div>
          </li>
        ))}
        {!L.remaining.length && <li className="text-sm text-ink-soft">Nothing left to fix.</li>}
      </ol>
      <Done L={L} />
    </div>
  );
}

/** B: sub-score rows with gap markers; fixes nested under the sub-score they lift. */
function VariantB({ L }: { L: Loop }) {
  const subsKeys = (Object.keys(WEIGHT) as Sub[]).sort(
    (a, b) => WEIGHT[b] * (100 - L.subs[b]) - WEIGHT[a] * (100 - L.subs[a])
  );
  return (
    <div className={cn(sw, 'space-y-4 p-6')}>
      <Gap L={L} />
      <p className={mono + ' text-steel'}>Sub-scores · most points lost first</p>
      <div className="space-y-4">
        {subsKeys.map((k) => {
          const lost = (WEIGHT[k] * (100 - L.subs[k])) / 100;
          const fixes = L.remaining.filter((f) => f.sub === k);
          return (
            <div key={k} className="border-b border-panel pb-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className={mono + ' text-ink-soft'}>
                  {LABEL[k]} <span className="text-steel">· weight {WEIGHT[k]}</span>
                </span>
                <span className="font-mono text-sm tabular-nums">
                  <span className={bandText(L.subs[k])}>{L.subs[k].toFixed(0)}%</span>{' '}
                  <span className="text-steel">· {lost.toFixed(1)} pts lost</span>
                </span>
              </div>
              <div className="h-2 border border-ink bg-white">
                <div className="h-full bg-primary" style={{ width: `${L.subs[k]}%` }} />
              </div>
              {fixes.map((f) => (
                <div
                  key={f.id}
                  className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-4"
                >
                  <div>
                    <p className="text-sm font-bold">{f.title}</p>
                    <p className="text-xs text-ink-soft">{f.detail}</p>
                  </div>
                  <FixAction f={f} L={L} compact />
                </div>
              ))}
              {!fixes.length && lost > 0 && (
                <p className="mt-2 pl-4 text-xs text-steel">
                  No automatic fix. Needs content from you.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Done L={L} />
    </div>
  );
}

/** C: one fix at a time, guided. Apply or skip; undo stack on the side. */
function VariantC({ L }: { L: Loop }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const queue = L.remaining.filter((f) => !skipped.includes(f.id));
  const cur = queue[0];
  return (
    <div className={cn(sw, 'space-y-4 p-6')}>
      <Gap L={L} />
      {cur ? (
        <div className="border-2 border-ink bg-paper p-5">
          <p className={mono + ' text-steel'}>Next best fix · {queue.length} left</p>
          <p className="mt-2 font-serif text-xl font-bold">{cur.title}</p>
          <p className="mt-1 text-sm text-ink-soft">{cur.detail}</p>
          <p className="mt-3 font-mono text-sm tabular-nums">
            {LABEL[cur.sub]}: {L.subs[cur.sub].toFixed(0)}% →{' '}
            <span className="text-success">
              {Math.min(100, L.subs[cur.sub] + cur.gain).toFixed(0)}%
            </span>{' '}
            · overall <span className="text-success">+{pts(cur).toFixed(1)}</span> →{' '}
            {(L.score + pts(cur)).toFixed(1)}
          </p>
          <div className="mt-4 flex flex-wrap items-start gap-2">
            <FixAction f={cur} L={L} />
            <button className={btn} onClick={() => setSkipped((s) => [...s, cur.id])}>
              Skip
            </button>
            <button
              className={btn}
              onClick={L.undoLast}
              disabled={!L.applied.length}
              style={{ opacity: L.applied.length ? 1 : 0.4 }}
            >
              Undo last
            </button>
          </div>
        </div>
      ) : (
        <div className="border-2 border-ink bg-paper p-5 text-sm">
          Queue empty.{' '}
          {skipped.length > 0 && (
            <button className="underline" onClick={() => setSkipped([])}>
              Bring back {skipped.length} skipped
            </button>
          )}
        </div>
      )}
      <Done L={L} />
    </div>
  );
}

const VARIANTS = {
  A: ['Ranked checklist', VariantA],
  B: ['By sub-score', VariantB],
  C: ['One at a time', VariantC],
} as const;
type Key = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as Key[];

function Switcher({ current }: { current: Key }) {
  const router = useRouter();
  const go = useCallback(
    (d: number) =>
      router.replace(`?variant=${KEYS[(KEYS.indexOf(current) + d + KEYS.length) % KEYS.length]}`),
    [router, current]
  );
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input,textarea,[contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go]);
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink px-5 py-2 font-mono text-sm text-white shadow-lg">
      <button onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {current} ({VARIANTS[current][0]})
      </span>
      <button onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}

function Inner() {
  const p = useSearchParams().get('variant') as Key | null;
  const current: Key = p && p in VARIANTS ? p : 'A';
  const L = useLoop();
  const V = VARIANTS[current][1];
  return (
    <main className="mx-auto max-w-6xl p-6">
      <p className="mb-4 font-mono text-xs uppercase tracking-wider text-steel">
        PROTOTYPE · stub data · target of a tailor preview: diff modal side panel
      </p>
      <div className="grid gap-6 md:grid-cols-[1fr_380px]">
        <div className="min-h-[480px] border border-ink bg-white p-6 shadow-sw-nested">
          <p className="font-serif text-2xl font-bold">Jane Doe</p>
          <p className="text-sm text-ink-soft">Software Engineer</p>
          <p className="mt-6 text-sm text-steel">[tailored resume preview, as in the diff modal]</p>
        </div>
        <V L={L} />
      </div>
      <Switcher current={current} />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
