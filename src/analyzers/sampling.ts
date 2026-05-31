import type { Message } from "../types/message.ts";
import type { ClassifiedContact } from "../types/contact.ts";

export const DEFAULT_BUCKETS = 5;

export function timeStratifiedSample(
  items: Message[],
  n: number,
  buckets: number = DEFAULT_BUCKETS,
): Message[] {
  if (items.length <= n) return [...items];
  const sorted = [...items].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const start = sorted[0]!.timestamp.getTime();
  const end = sorted[sorted.length - 1]!.timestamp.getTime();
  if (end === start) return uniformStride(sorted, n);

  const span = end - start;
  const bucketSize = span / buckets;
  const grouped: Message[][] = Array.from({ length: buckets }, () => []);
  for (const m of sorted) {
    let idx = Math.floor((m.timestamp.getTime() - start) / bucketSize);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    grouped[idx]!.push(m);
  }

  const out: Message[] = [];
  const baseQuota = Math.floor(n / buckets);
  const remainder = n - baseQuota * buckets;

  let unfilled = 0;
  for (let i = 0; i < buckets; i++) {
    const bucket = grouped[i]!;
    const quota = baseQuota + (i < remainder ? 1 : 0);
    if (bucket.length <= quota) {
      out.push(...bucket);
      unfilled += quota - bucket.length;
    } else {
      out.push(...uniformStride(bucket, quota));
    }
  }

  if (unfilled > 0) {
    const leftover = sorted.filter((m) => !out.includes(m));
    out.push(...uniformStride(leftover, Math.min(unfilled, leftover.length)));
  }

  out.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return out;
}

export function uniformStride<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const stride = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.floor(i * stride)]!);
  }
  return out;
}

export interface PersonaQuotaPlan {
  total_requested: number;
  per_label: Record<string, { quota: number; contact_ids: string[] }>;
  per_contact: Record<string, { contact_id: string; label: string; quota: number }>;
}

export function planPersonaQuota(
  classified: ClassifiedContact[],
  totalN: number,
): PersonaQuotaPlan {
  const byLabel = new Map<string, ClassifiedContact[]>();
  for (const c of classified) {
    let arr = byLabel.get(c.label);
    if (!arr) {
      arr = [];
      byLabel.set(c.label, arr);
    }
    arr.push(c);
  }
  const labels = [...byLabel.keys()];
  if (labels.length === 0) {
    return { total_requested: totalN, per_label: {}, per_contact: {} };
  }
  const perLabel = Math.floor(totalN / labels.length);
  const labelRemainder = totalN - perLabel * labels.length;

  const per_label: PersonaQuotaPlan["per_label"] = {};
  const per_contact: PersonaQuotaPlan["per_contact"] = {};

  let i = 0;
  for (const label of labels) {
    const labelQuota = perLabel + (i < labelRemainder ? 1 : 0);
    const contacts = byLabel.get(label)!;
    const perContact = Math.floor(labelQuota / contacts.length);
    const contactRemainder = labelQuota - perContact * contacts.length;
    per_label[label] = {
      quota: labelQuota,
      contact_ids: contacts.map((c) => c.contact_id),
    };
    let j = 0;
    for (const c of contacts) {
      const quota = perContact + (j < contactRemainder ? 1 : 0);
      per_contact[c.contact_id] = {
        contact_id: c.contact_id,
        label: c.label,
        quota,
      };
      j++;
    }
    i++;
  }

  return { total_requested: totalN, per_label, per_contact };
}
