import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, http, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import type { CartListing, CartSplit } from '../../src/sdk/types/cart.js';

const seller = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
const cases: {name:string; splits?:CartSplit[]}[] = [
  {name:'omitted splits'},
  {name:'seller-authorized splits',splits:[{recipient:seller.address,basisPoints:8000},{recipient:'0x0000000000000000000000000000000000003333',basisPoints:2000}]},
];

describe('Cart seller split publication over HTTP', () => {
  it.each(cases)('preserves $name from preview through signing and publication', async ({splits}) => {
    const listing: CartListing = {listingSalt:`0x${'11'.repeat(32)}`,seller:seller.address,sku:`0x${'22'.repeat(32)}`,
      fulfillmentKind:1,tokenContract:zeroAddress,tokenId:0n,settlementCurrency:zeroAddress,
      minimumUnitPrice:100n,availableQuantity:2n,paymentRecipient:seller.address,splits:splits??[]};
    const requests: unknown[] = [];
    const server = createServer(async (request,response) => {
      const chunks:Buffer[]=[];
      for await(const chunk of request) chunks.push(Buffer.from(chunk));
      const body:unknown=JSON.parse(Buffer.concat(chunks).toString());
      response.setHeader('content-type','application/json');
      if(request.url==='/rpc') {
        if(typeof body!=='object'||body===null||!('id' in body)) throw new Error('Invalid RPC fixture');
        response.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:`0x${'0'.repeat(64)}`}));
      } else {
        requests.push(body);
        response.end(JSON.stringify({data:request.url?.startsWith('/v1/cart/listings/preview')
          ? {listings:[{...listing,tokenId:'0',minimumUnitPrice:'100',availableQuantity:'2'}]}
          : {id:'published-root'}}));
      }
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const address=server.address();
    if(address===null||typeof address==='string') throw new Error('Missing fixture HTTP address');
    const origin=`http://127.0.0.1:${address.port}`;
    const rare=createRareClient({apiBaseUrl:origin,transport:(path,init)=>fetch(`${origin}${path}`,init),
      publicClient:createPublicClient({chain:sepolia,transport:http(`${origin}/rpc`)}),
      walletClient:createWalletClient({chain:sepolia,account:seller,transport:http(`${origin}/rpc`)}),
    });
    try {
      const preparation=await rare.cart.listing.prepare({seller:seller.address,deadline:2000000000n,
        listings:[{sku:listing.sku,unitPrice:100n,quantity:2n,settlementCurrency:zeroAddress,...(splits===undefined?{}:{splits})}]});
      const result=await rare.cart.listing.publish({preparation});
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({listings:[{splits:listing.splits}]});
      expect(requests[1]).toMatchObject({intent:{listings:[{splits:listing.splits}]},artifact:{entries:[{listing:{splits:listing.splits}}]}});
      expect(result.signedArtifact.entries[0]?.listing.splits).toEqual(listing.splits);
      expect(result.signedArtifact.signature).toMatch(/^0x[0-9a-f]+$/iu);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
