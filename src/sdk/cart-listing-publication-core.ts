import { isAddressEqual, type Address, type Hex } from 'viem';
import { validateCartListingRootArtifact } from './cart-core.js';
import type { CartListingPreparation, CartListingRootArtifact } from './types/cart.js';

/** Bind recovery to the original order of listings, seller and deployment. */
export function validateCartListingPublication(
  preparation: CartListingPreparation,
  retained: (CartListingRootArtifact & { signature: Hex }) | undefined,
  scope: { chainId: number; cart: Address; seller: Address },
): void {
  const artifact = preparation.artifact;
  validateCartListingRootArtifact(artifact);
  if (artifact.chainId !== scope.chainId || !isAddressEqual(artifact.cart, scope.cart) ||
    !isAddressEqual(artifact.seller, scope.seller) || !isAddressEqual(preparation.intent.seller, scope.seller) ||
    BigInt(artifact.root.deadline) !== preparation.intent.deadline) {
    throw new Error('Listing preparation does not match the connected seller, deployment or terms.');
  }
  if (retained === undefined) return;
  validateCartListingRootArtifact(retained);
  if (retained.signature === '0x' || retained.chainId !== artifact.chainId ||
    !isAddressEqual(retained.cart, artifact.cart) || !isAddressEqual(retained.seller, artifact.seller) ||
    retained.root.listingsRoot !== artifact.root.listingsRoot || retained.root.nonce !== artifact.root.nonce ||
    retained.root.deadline !== artifact.root.deadline || retained.entries.length !== artifact.entries.length ||
    retained.entries.some((entry, index) => entry.listingDigest !== artifact.entries[index]?.listingDigest)) {
    throw new Error('Retained Listing authorization does not match its preparation.');
  }
}
