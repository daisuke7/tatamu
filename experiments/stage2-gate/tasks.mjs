// Stage 2 gate experiment — task set.
// Five std-only, single-file tasks chosen to be hard enough that first-shot
// compilation is not guaranteed (ownership, lifetimes, trait bounds, dyn
// closures, impl-Trait returns). The same prompts are used for both
// conditions; only the target language section differs.

export const TASKS = [
  {
    id: "graph-reach",
    spec: `Write a program with:
1. \`fn add_edge(graph: &mut HashMap<String, Vec<String>>, from: &str, to: &str)\` — inserts a directed edge, creating the node entry on demand.
2. \`fn reachable(graph: &HashMap<String, Vec<String>>, start: &str) -> HashSet<String>\` — the set of nodes reachable from \`start\` (including \`start\` itself if present in the graph, excluding it otherwise only if it has no entry). Use an explicit work stack, no recursion.
3. \`fn prune_unreachable(graph: &mut HashMap<String, Vec<String>>, root: &str)\` — removes every node (key AND its appearances inside other nodes' edge lists) that is not reachable from \`root\`.
4. \`main\` builds the graph a->b, b->c, d->e, prunes from "a", and asserts the remaining keys are exactly {a, b, c} and that no edge list mentions "d" or "e".`,
  },
  {
    id: "borrowed-index",
    spec: `Write a program with:
1. \`struct Index<'a>\` holding \`by_len: HashMap<usize, Vec<&'a str>>\`.
2. \`fn build<'a>(words: &'a [String]) -> Index<'a>\` — groups word slices by their length.
3. \`impl<'a> Index<'a>\`: \`fn longest_group(&self) -> Option<(usize, &[&'a str])>\` returning the (length, group) with the most entries; ties broken by larger length.
4. \`fn common_prefix<'a>(items: &[&'a str]) -> &'a str\` — the longest common prefix of all items (empty slice -> "").
5. \`main\`: words = ["hat","cat","car","house","mouse"], build the index, assert longest_group is the length-3 group with 3 entries, and assert common_prefix(&["car","cat"]) == "ca".`,
  },
  {
    id: "generic-topk",
    spec: `Write a program with:
1. \`fn top_k_by<T, F, K>(items: &[T], k: usize, key: F) -> Vec<&T>\` where \`F: Fn(&T) -> K\` and \`K: Ord\` — returns references to the k items with the LARGEST keys, ordered descending by key; stable for ties (earlier item first). Do not clone the items.
2. \`struct City\` with \`name: String\`, \`pop: u64\` (derive nothing you don't need).
3. \`main\`: five cities with populations [900, 1200, 1200, 300, 5000]; take top 3 by population and assert the names come out in the exact expected order (the 5000 one, then the FIRST 1200 one, then the second 1200 one).`,
  },
  {
    id: "dyn-pipeline",
    spec: `Write a program with:
1. \`struct Pipeline\` holding named stages: \`Vec<(String, Box<dyn Fn(i64) -> i64>)>\`.
2. \`impl Pipeline\`: \`fn new() -> Self\`; \`fn stage(mut self, name: &str, f: impl Fn(i64) -> i64 + 'static) -> Self\` (builder style); \`fn run(&self, input: i64) -> Vec<(String, i64)>\` — applies stages in order, recording each stage's name and its output.
3. In \`main\`, build a pipeline where the SECOND stage multiplies by a factor read from a local variable (forcing a move closure), run it on 10, and assert the full trace: stage "add1" -> 11, stage "times" (factor 3) -> 33, stage "sub2" -> 31.`,
  },
  {
    id: "windowed-iter",
    spec: `Write a program with:
1. \`fn deltas<'a>(v: &'a [i64]) -> impl Iterator<Item = i64> + 'a\` — the pairwise differences v[i+1]-v[i], lazily (no intermediate Vec).
2. \`fn longest_rising_run(v: &[i64]) -> usize\` — the length (in ELEMENTS, not deltas) of the longest strictly-increasing contiguous run; empty slice -> 0, single element -> 1. Implement it ON TOP of \`deltas\` (consume the delta iterator; do not index the original slice again).
3. \`main\`: for v = [1,2,3,2,5,6,7,8,1], assert deltas().collect::<Vec<_>>() == [1,1,-1,3,1,1,1,-7] and longest_rising_run == 5.`,
  },
];
