# Cart deployment and signed payloads

New Sepolia authoring and checkout use the November 1 Cart proxy
`0xB08876F9c661667Af22e85859357bB31c4e11741`. Approvals target this proxy.
The matching Lens is `0xb6812159892B48363b6B3ec4e8f0c34944D8E4Ab` and
Hashes helper is `0x78554E14fb196De79a8E4ce49C1fCa4e6D46b8bd`.
Bindings are generated from core revision
`593f13bf465b43c2ace4f37fe246b704c16d30a4`.

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

The old proxy `0x1EBF35b3A76caEf60a009d2786A66A91D42A38Bc` is paused. Its
historical receipts remain historical data. The new proxy starts with empty
fill, cancellation, nonce and replay state. Do not copy old listings into the
new deployment as available inventory: sellers must authorize new roots with
intended remaining quantities, and payers and sellers need new approvals.

Changing the proxy domain or Listing splits changes digests even when splits
are empty. Rebuild roots, proofs, seller signatures, orders and platform
signatures together. Clear old-domain quote caches rather than relabeling them.
