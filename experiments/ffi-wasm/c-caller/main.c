/* C program calling the Tatamu staticlib via the GENERATED header. */
#include <stdio.h>
#include "tatamu-ffi.h"

int main(void) {
    printf("add(20, 22)  = %lld\n", (long long)tatamu_add(20, 22));
    printf("fib(50)      = %llu\n", (unsigned long long)tatamu_fib(50));
    printf("gcd(48, 180) = %llu\n", (unsigned long long)tatamu_gcd(48, 180));

    Point a = {1.0, 2.0};
    Point b = {3.0, 4.0};
    printf("dot(a, b)    = %.1f\n", tatamu_dot(a, b));
    return 0;
}
