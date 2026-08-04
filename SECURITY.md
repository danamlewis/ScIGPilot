# Security Policy

## Reporting a vulnerability

Do not place sensitive exploit details or real health information in a public issue.

Use GitHub private vulnerability reporting for this repository if it is enabled. If it is not available, open a minimal public issue asking the maintainer for a private contact channel; omit reproduction details until a private channel is established.

Include the affected page or function, impact, browser and operating system, and the smallest synthetic reproduction that demonstrates the issue. Never use real patient information in a report.

## Scope

The application is a static client-side site. Security-sensitive areas include:

- decoding and rendering shared-link state;
- handling free-text regimen and product names;
- third-party scripts loaded by the page;
- printable and QR-based exports; and
- denial-of-service risks from oversized or extreme simulator inputs.

Clinical disagreement with an illustrative assumption is normally a model or documentation issue rather than a security vulnerability, unless it is caused by tampering, unsafe data handling, or misleading output that contradicts the documented calculation.
