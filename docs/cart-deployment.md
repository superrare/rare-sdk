# Cart deployment and signed payloads

New Sepolia authoring and checkout use the November 6 Cart proxy
`0xACfF2622f53f360274df3014DC135EfDC058786B`. Approvals target this proxy.
The matching Lens is `0xD9f2ED84317D517fc8e393227D76c63227e3f823` and
Hashes helper is `0xD0e7aeE76485Bb3D6af3aBa187014DC636afF12A`.
Bindings are generated from core revision
`042bcd74143986629eaf7f45d683e4df3af23b3e`.

Every canonical Listing includes `splits`, including `[]` for a sole recipient.
Creator Listing inputs may omit splits; new authoring supplies the empty array.
Saved artifacts without that field must be recreated and signed again. The SDK
does not upgrade old signed artifacts or reuse their signatures.

Splits belong to each seller-signed Listing. They must contain at most sixteen
unique nonzero recipients with positive basis points totaling 10,000. The first
recipient must equal `paymentRecipient` and receives rounding remainder. Cart
cannot receive a split. Use `allocateCartListingPayment` from the utils subpath
to calculate allocations for one final merchandise line; round each line before
aggregating transfers. Fees, shipping and swap lines do not inherit these splits.

`PurchaseOrder.spreadRecipient` is required, nonzero, and platform-signed. Its
position follows `paymentAmount`. Treasury policy belongs to the trusted signer;
callers cannot redirect an already signed order's execution surplus.

The previous November 1 proxy `0xB08876F9c661667Af22e85859357bB31c4e11741`
was not modified by this deployment. The earlier proxy
`0x1EBF35b3A76caEf60a009d2786A66A91D42A38Bc` remains retired.
Historical receipts retain their original contract addresses. The new proxy starts with empty
fill, cancellation, nonce and replay state. Do not copy old listings into the
new deployment as available inventory: sellers must authorize new roots with
intended remaining quantities, and payers and sellers need new approvals.

Changing the proxy domain or Listing splits changes digests even when splits
are empty. Rebuild roots, proofs, seller signatures, orders and platform
signatures together. Clear old-domain quote caches rather than relabeling them.

The [core deployment record](https://github.com/superrare/core/blob/keegan/cart-fixed-quote-currency-swap/docs/cart-sepolia-fresh-2026-11-06.md) records all six contracts, receipts, and runtime checks.

The November 6 policy upgrade preserves the proxy, EIP-712 domain, approvals, and all purchase state. The matching Lens uses the policy's Cart-aware preview entry point. The [policy upgrade record](https://github.com/superrare/core/blob/keegan/cart-fixed-quote-currency-swap/docs/cart-sepolia-policy-upgrade-2026-11-06.md) records the replacement bundle and confirmed upgrade.

SDK checkout estimates the exact signed execution payload with the actual payer
and value. The submitted gas limit includes a rounded-up 25% buffer and must
fit the platform's 12,000,000 gas ceiling. An estimate above 9,600,000 gas is
rejected rather than trimming its safety margin. Missing balances or approvals
are prerequisites, not proof that a checkout fits the budget. The backend must
independently apply admission before releasing its platform signature.
