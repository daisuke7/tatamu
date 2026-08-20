// Blind/large-scale lens experiment — free-form questions over memchr.
//
// D* questions: the answer lives ONLY in externalized comments/docs.
// C* questions: derivable from the code alone.
//
// Free-form answers are graded by a judge model against `reference` facts
// with an explicit `rubric` (binary correct/incorrect).

export const QUESTIONS = [
  {
    id: "d1-overlap-loads",
    kind: "doc",
    q: `In the generic vector implementation of memchr (\`src/arch/generic/memchr.rs\`), the routine deliberately performs overlapping loads at the edges of the haystack (before the aligned primary loop and after it). Why is this done, and why is the overlap acceptable? Answer in 1-3 sentences.`,
    reference: `Unaligned edge loads let the code search the first/last chunk with vector instructions instead of a byte-at-a-time loop (the final unaligned load "converts a loop into a small number of very fast vector instructions"). The overlap with previously searched bytes is acceptable because those overlapping positions are already known to contain no match.`,
    rubric: `Correct only if BOTH points are present in some form: (1) the purpose — using (unaligned) vector loads at the edges avoids a scalar byte-at-a-time loop / lets vectors cover the unaligned head or tail; (2) the justification — the overlapped region was already searched / is known not to contain a match, so re-scanning it is harmless.`,
  },
  {
    id: "d2-64byte-loop",
    kind: "doc",
    q: `The primary loop of the generic memchr routine processes 64 bytes per iteration (four vectors) rather than one vector at a time. According to the implementation's rationale, how does it keep the per-iteration match check cheap despite comparing four vectors? Answer in 1-2 sentences.`,
    reference: `It combines the equality comparison results of the four vectors with a vector OR, so only a single movemask extraction is needed to decide whether any match exists; only when that mask is non-zero does it do the bookkeeping to locate the precise position.`,
    rubric: `Correct only if the answer says the four comparison results are OR-ed together (combined into one vector) so that a single mask extraction / movemask test suffices per iteration.`,
  },
  {
    id: "d3-twoway-inline-variants",
    kind: "doc",
    q: `In \`src/arch/all/twoway.rs\`, the forward search is compiled as separate explicitly-inlined variants depending on whether a prefilter is used. According to the comment there, why are there separate variants instead of one function that checks a prefilter option at runtime, and where is the decision between them made? Answer in 1-3 sentences.`,
    reference: `A prefilter can accelerate each search implementation but is not always enabled; to avoid the prefilter's overhead when it is disabled, each search implementation is explicitly inlined for the with-prefilter and without-prefilter cases. The decision of which variant to use is made in the parent "meta" searcher.`,
    rubric: `Correct only if BOTH: (1) the split exists to avoid prefilter overhead when the prefilter is disabled (avoiding a runtime check/cost in the no-prefilter path); (2) the choice between variants is made by the parent/meta searcher (outside twoway itself).`,
  },
  {
    id: "d4-reverse-no-prefilter",
    kind: "doc",
    q: `Reverse searches in \`src/arch/all/twoway.rs\` do not use a prefilter. What justification does the code give for that choice? Answer in 1-2 sentences.`,
    reference: `It's plausible a reverse prefilter could help, but it would require a lot of additional code and it's not clear it's actually worth it; the comment asks anyone with a really compelling use case to file an issue.`,
    rubric: `Correct only if the answer conveys that supporting a reverse prefilter would take substantial extra code AND its benefit is unclear/unproven (mentioning the "file an issue" invitation is a bonus, not required). Answers claiming it is impossible or algorithmically invalid are incorrect.`,
  },
  {
    id: "d5-skip-sentinel",
    kind: "doc",
    q: `In \`src/memmem/searcher.rs\`, the prefilter state stores a \`skipped\` count in a \`u32\`. What is special about the value 0 there, and what adjustment does the code make when reading the count? Answer in 1-2 sentences.`,
    reference: `0 is a sentinel meaning the prefilter state is inert (not yet in use), so the stored value is offset by one: the code always subtracts 1 to get the actual number of skips.`,
    rubric: `Correct only if the answer states that 0 is a sentinel for the inert/unused state AND that 1 must be subtracted to obtain the real skip count.`,
  },
  {
    id: "d6-small-fallback",
    kind: "doc",
    q: `In the short-haystack path of \`src/memmem/searcher.rs\`, the code deliberately does NOT call \`crate::memchr\` and instead jumps straight to the fallback implementation. Why, according to the code's own explanation? Answer in 1-2 sentences.`,
    reference: `The haystack is small enough that memchr's vector routines couldn't be used anyway, so going straight to the fallback is likely faster; a byte-at-a-time loop is only used for haystacks smaller than size_of::<usize>().`,
    rubric: `Correct only if the answer says the haystack is too small for the vector routines to kick in, making the direct fallback (likely) faster. Mentioning the size_of::<usize> threshold is a bonus but not required.`,
  },
  {
    id: "d7-sse2-missing",
    kind: "doc",
    q: `\`src/memmem/searcher.rs\` contains a code path for running on x86_64 WITHOUT SSE2. According to the comment there, how can that situation arise, given that SSE2 is part of the x86_64 baseline? Answer in 1-2 sentences.`,
    reference: `It is up to the operating system whether it supports vector registers; an OS can choose not to, so a program can find itself on x86_64 without usable SSE2.`,
    rubric: `Correct only if the answer attributes the possibility to the OS deciding (not) to support vector registers / SIMD state, rather than to the CPU lacking the instructions.`,
  },
  {
    id: "d8-abstraction-breaker",
    kind: "doc",
    q: `\`src/memmem/mod.rs\` re-exports a prefilter-related item for use by the \`arch::all::twoway\` implementation and describes this as an "abstraction breaker". According to the explanation there, why does this crate-internal path exist instead of a public API? Answer in 1-3 sentences.`,
    reference: `Two-Way's public API doesn't support providing a prefilter, but its crate-internal API does; the export exists so twoway can get one. The author didn't want to do the API design needed to support prefilters publicly without a concrete use case.`,
    rubric: `Correct only if BOTH: (1) twoway's public API lacks prefilter support while the crate-internal API has it (hence the internal export); (2) the reason given — the author avoided doing the public API design absent a concrete use case.`,
  },
  {
    id: "c1-arch-sets",
    kind: "code",
    q: `Which SIMD instruction sets have dedicated implementations under \`src/arch/\`? List them. Answer in one sentence.`,
    reference: `SSE2 and AVX2 (x86_64), NEON (aarch64), and simd128 (wasm32).`,
    rubric: `Correct only if all four are listed: SSE2, AVX2, NEON, simd128 (wasm32's simd128 may be phrased as "wasm simd128"). Missing any one is incorrect; naming the architecture directories without the instruction sets is incorrect.`,
  },
  {
    id: "c2-vector-trait",
    kind: "code",
    q: `The generic implementations in \`src/arch/generic/\` are written against an abstraction so the same code serves every instruction set. What is that abstraction (name it)? Answer in one sentence.`,
    reference: `The (unsafe) Vector trait defined in src/vector.rs.`,
    rubric: `Correct only if the answer names the Vector trait.`,
  },
  {
    id: "c3-ranker-default",
    kind: "code",
    q: `\`arch::all::packedpair::Pair::new\` selects its byte pair using a default ranker. What is the name of that default ranker type, and what does its \`rank\` method map? Answer in 1-2 sentences.`,
    reference: `DefaultFrequencyRank; its rank method maps a byte (u8) to a u8 frequency rank (higher = more common in the background distribution).`,
    rubric: `Correct only if the answer names DefaultFrequencyRank AND says rank maps a byte (u8) to a u8 rank/score.`,
  },
  {
    id: "c4-swar-width",
    kind: "code",
    q: `The portable fallback in \`src/arch/all/memchr.rs\` (no SIMD) still avoids a pure byte-at-a-time scan in its core loop. What unit does its core loop read per step? Answer in one sentence.`,
    reference: `The core loop reads machine words (usize) rather than bytes — specifically two usize words per iteration (LOOP_BYTES = 2 * USIZE_BYTES, i.e. 16 bytes on 64-bit), SWAR style.`,
    rubric: `Correct if the answer says the loop reads machine words / usize values (SWAR) rather than single bytes or SIMD vectors. Saying "one usize", "two usize per iteration", or "2*USIZE_BYTES (16 bytes on 64-bit) as two word loads" are all acceptable. Only answers claiming byte-at-a-time or SIMD vector loads are incorrect.`,
  },
];
