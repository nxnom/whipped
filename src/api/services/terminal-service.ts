// Terminal operations are pure ctx/scheduler delegations (buffer/resize/input),
// so the controller calls ctx directly. The only data shaping is normalising a
// possibly-missing output buffer into the response envelope.
export const toBufferResponse = (buffer: string | null | undefined): { data: string } => ({ data: buffer ?? "" });
