export const problem = (status, code, details = {}) =>
  Object.assign(new Error(code), { status, code, ...details });
export const unavailable = () => problem(503, "service_unavailable");
// Reserve 150ms of the overall budget for rollback/disposal and response handling.
export class Budget {
  constructor(ms = 5000) {
    this.end = performance.now() + ms;
  }
  remaining(cap = Infinity) {
    const ms = Math.floor(Math.min(cap, this.end - performance.now() - 150));
    if (ms <= 0) throw unavailable();
    return ms;
  }
}
export async function connection(pool, budget, fn) {
  let client,
    discarded = false,
    timer;
  const acquiring = pool.connect();
  try {
    client = await Promise.race([
      acquiring,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), budget.remaining(1000));
      }),
    ]);
  } catch (e) {
    acquiring.then(
      (c) => c.release(true),
      () => {},
    );
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
  const discard = () => {
    if (!discarded) {
      discarded = true;
      client.release(true);
    }
  };
  async function raw(sql, values = [], cap = 2000) {
    if (discarded) throw unavailable();
    const milliseconds = budget.remaining(cap);
    let clock;
    try {
      return await Promise.race([
        client.query(sql, values),
        new Promise((_, reject) => {
          clock = setTimeout(() => {
            discard();
            reject(unavailable());
          }, milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(clock);
    }
  }
  const q = async (sql, values = [], cap = 2000) => {
    const ms = budget.remaining(cap);
    await raw(
      "select set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)",
      [
        String(Math.max(1, ms - 25)),
        String(Math.max(1, Math.min(1000, ms - 50))),
      ],
      Math.min(ms, 2000),
    );
    return raw(sql, values, cap);
  };
  try {
    return await fn(q, client);
  } catch (e) {
    if (!discarded) {
      try {
        await raw("rollback", [], 100);
      } catch {
        discard();
      }
    }
    throw e;
  } finally {
    if (!discarded) client.release();
  }
}
export function publicError(e) {
  if (e.status) return e;
  if (e.code === "23505") return problem(409, "effective_date_conflict");
  if (
    e.code?.startsWith("23") ||
    ["22P02", "22007", "22008", "22003"].includes(e.code)
  )
    return problem(400, "constraint_violation");
  return unavailable();
}
