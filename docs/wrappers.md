# Functions that choose the algorithm from a parameter

This applies to C, C++, Rust and Go.

A project often wraps a crypto call in a function of its own, and lets the caller choose the algorithm:

```c
const EVP_MD *pick(const char *name) {
    return EVP_get_digestbyname(name);   // unresolved: the algorithm is whatever the caller passes
}
```

Read on its own, that line cannot say which algorithm is used, so it is reported as `unresolved`. The scanner then follows the function to where it is called, anywhere in the folder scanned:

- **A call that passes a value written in the code** is reported where it is, with the algorithm: `pick("sha1")` is reported as SHA-1, `needs-review`, on the line of the call.
- **A call that passes its own parameter on** (`void f(const char *alg) { pick(alg); }`) makes that function a wrapper too, and its callers are followed in the same way, up to five functions deep.
- **Calls that pass a value that cannot be read**, such as a setting read at run time, are listed on the wrapper's own unresolved finding instead of being reported one by one: "The algorithm is parameter 1 ("name") of pick(), so its callers choose it. 2 call(s) pass a value that cannot be read here, such as main.c:4, api.c:31; check those by hand." When no call is found at all, the finding says so.

## Which calls count

A call is matched to a function only where the language allows that call, so a function is not confused with another of the same name:

- **C and C++:** a `static` function only in its own file; `Class::f` only as `Class::f(...)` or from its own file; a C function also from C++, and from Go through cgo (`C.f(...)`).
- **Rust:** a private function (no `pub`) only in its own file; `Type::f` only as `Type::f(...)` or from its own file.
- **Go:** an unexported function (lower-case name) only in its own package (folder); an exported one as `pkg.F(...)` from other packages.
- **Not followed:** a method called on a value (`h.pick("sha1")`, `self.pick(...)`), because the value's type is not known here; and a function the rules already name, such as a crypto library's own source defining `wc_AesGcmSetKey`, since calls to it are reported directly.

When two functions of the same name could be meant and they choose the algorithm differently, nothing is guessed: the call is listed on both.

## Tested on

On the 34 projects the scanner is tested on, following wrappers added findings only in C and C++ code, each a call that passes a value written in the code. A sample from each project was checked by hand.

| Code | Findings added | Wrappers found |
|---|---|---|
| wolfSSL | 496 (322 resistant, 95 needs review, 79 unresolved) | 134 |
| GnuTLS | 66 (21 resistant, 25 needs review, 20 vulnerable) | 57 |
| Mbed TLS | 30 (21 resistant, 8 needs review, 1 vulnerable) | 34 |
| TF-PSA-Crypto | 24 (14 resistant, 8 needs review, 2 vulnerable) | 26 |
| Botan | 15 (6 resistant, 3 needs review, 6 unresolved) | 29 |
| RNP | 4 vulnerable | 4 |
| cpp-httplib | 3 (2 resistant, 1 needs review) | 1 |

The unresolved findings added are calls that pass a value the rule does not know, such as `0` for "no key yet" in wolfSSL's tests, or names Botan's tests pass on purpose to check they are refused (`"Blake2b(9)"`).

Following wrappers reads again the files that call one, so it adds time where there are many: wolfSSL took 7.8 seconds instead of 5.0, GnuTLS 3.1 instead of 2.2, and Mbed TLS 2.4 instead of 1.8. HashiCorp Vault, which has none, took 3.9 seconds instead of 3.6.
