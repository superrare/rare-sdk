import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionData, encodeAbiParameters, toEventSelector, parseEventLogs, getAddress, zeroAddress, type Hex } from 'viem';
import vector from '../../fixtures/cart/core-split-vectors.json';
import { cartAbi } from '../../../src/contracts/abis/cart.js';
import { allocateCartListingPayment, buildCartListingRootArtifact, buildCartOrder, hashCartListing, hashCartPurchaseOrder, validateCartListings } from '../../../src/sdk/cart-core.js';
import type { CartListing } from '../../../src/sdk/types/cart.js';

const cart = getAddress(vector.domain.verifyingContract);
const listing: CartListing = {
  listingSalt: `0x${'11'.repeat(32)}`, seller: getAddress(vector.value.seller), sku: `0x${'22'.repeat(32)}`,
  fulfillmentKind: 1, tokenContract: zeroAddress, tokenId: 0n, settlementCurrency: zeroAddress,
  minimumUnitPrice: 100n, availableQuantity: 3n, paymentRecipient: getAddress(vector.value.paymentRecipient),
  splits: vector.value.splits.map(split => ({...split, recipient: getAddress(split.recipient)})),
};

describe('seller-signed Cart splits', () => {
  it('matches the independently generated core ethers vectors, including empty splits', () => {
    expect(hashCartListing(listing, 1, cart)).toBe(vector.populated);
    expect(hashCartListing({...listing,splits:[]}, 1, cart)).toBe(vector.empty);
    expect(hashCartListing({...listing,splits:[...listing.splits].reverse()}, 1, cart)).not.toBe(vector.populated);
  });
  it('validates shares, recipient identity, the sixteen-recipient bound, and Cart exclusion', () => {
    const recipient=listing.splits[1]!.recipient;
    const invalid: CartListing['splits'][] = [
      [{recipient:listing.paymentRecipient,basisPoints:9999}],
      [{recipient:listing.paymentRecipient,basisPoints:10001}],
      [{recipient:listing.paymentRecipient,basisPoints:10000},{recipient,basisPoints:0}],
      [{recipient:listing.paymentRecipient,basisPoints:8000},{recipient:listing.paymentRecipient,basisPoints:2000}],
      [{recipient:listing.paymentRecipient,basisPoints:8000},{recipient:zeroAddress,basisPoints:2000}],
      [{recipient,basisPoints:10000}],
      [{recipient:listing.paymentRecipient,basisPoints:8000},{recipient:cart,basisPoints:2000}],
      Array.from({length:17},(_,i)=>({recipient:getAddress(`0x${(i+1).toString(16).padStart(40,'0')}`),basisPoints:i===0?9984:1})),
    ];
    expect(validateCartListings([listing],cart).isValid).toBe(true);
    for(const splits of invalid) expect(validateCartListings([{...listing,splits}],cart).isValid).toBe(false);
  });
  it('rounds per line before aggregation and isolates listings with shared recipients', () => {
    const allocations=allocateCartListingPayment(listing,3n);
    expect(allocations.map(split=>split.amount)).toEqual([3n,0n]);
    expect(allocateCartListingPayment(listing,6n).map(split=>split.amount)).toEqual([5n,1n]);
    expect(allocateCartListingPayment({...listing,splits:[]},3n)).toEqual([{recipient:listing.paymentRecipient,amount:3n}]);
    expect(allocateCartListingPayment(listing,(1n<<256n)-1n).reduce((total,split)=>total+split.amount,0n)).toBe((1n<<256n)-1n);
  });
  it('decodes per-line split accounting including a rounded-zero share', () => {
    const orderId = `0x${'33'.repeat(32)}` as const;
    const listingDigest = hashCartListing(listing, 1, cart);
    const topics: [Hex, ...Hex[]] = [toEventSelector('ListingSplitPaid(bytes32,uint256,bytes32,address,address,uint256)'), orderId, encodeAbiParameters([{type:'uint256'}],[2n]), listingDigest];
    const data = encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'}],[zeroAddress,listing.splits[1]!.recipient,0n]);
    const logs = parseEventLogs({abi:cartAbi,eventName:'ListingSplitPaid',logs:[{address:cart,topics,data,blockHash:null,blockNumber:null,logIndex:null,transactionHash:null,transactionIndex:null,removed:false}]});
    expect(logs[0]?.args).toEqual({orderId,lineIndex:2n,listingDigest,currency:zeroAddress,recipient:listing.splits[1]!.recipient,amount:0n});
  });
  it('binds spread destination and new Listing tuples in the exact executable payload', () => {
    const root=buildCartListingRootArtifact({listings:[listing],chainId:1,cart,nonce:0n,deadline:2000000000n});
    const built=buildCartOrder({orderId:`0x${'33'.repeat(32)}`,paymentCurrency:zeroAddress,deadline:2000000000n,
      paymentAmount:100n,spreadRecipient:listing.seller,lines:[{sku:listing.sku,listingDigest:root.entries[0]!.listingDigest,
      fulfillmentKind:1,quantity:1n,settlementCurrency:zeroAddress,amount:100n,paymentRecipient:listing.paymentRecipient}]});
    expect(hashCartPurchaseOrder(built.order,1,cart)).not.toBe(hashCartPurchaseOrder({...built.order,spreadRecipient:listing.paymentRecipient},1,cart));
    const payload=encodeFunctionData({abi:cartAbi,functionName:'executePurchase',args:[built.order,built.lines,[listing],{
      listingRoots:[{listingsRoot:root.root.listingsRoot,nonce:0n,deadline:2000000000n}],listingRootSignatures:['0x'],listingRootIndexes:[0n],listingProofs:[[]],
    },built.route,built.actions,'0x']});
    const decoded=decodeFunctionData({abi:cartAbi,data:payload});
    expect(decoded.functionName).toBe('executePurchase');
    if(decoded.functionName!=='executePurchase') throw new Error('Unexpected payload');
    expect(decoded.args[0].spreadRecipient).toBe(built.order.spreadRecipient);
    expect(decoded.args[2][0]!.splits).toEqual(listing.splits);
  });
});
