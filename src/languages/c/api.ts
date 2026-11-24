// What other languages may use from the C support: C++ and Go call C libraries directly, so they match C's rules,
// and C++ reads some `.h` files with the C grammar. Everything else in this folder is private to C.
export { type CLookup, blankDirectives, callFindings, cLookupFor, grammar, loadC, passes, scanCTree } from './adapter.ts';
