import { downloadTestImage } from '../helpers/test-image.js';
import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, erc721Abi, getAddress, http, isAddressEqual, isHex, keccak256, toHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { createRareClient, RareApiError } from '../../dist/sdk/index.js';
import type { CreatePrintDrop, PreparePrintListing } from '../../dist/sdk/index.js';
import { loadDotEnv } from '../helpers/env.js';
import { findCartOrderInHistory } from '../helpers/cart-order-history.js';
import { createCreatorCartScenario } from '../helpers/cart-creator-fixture.js';
import { getTestRpcUrl } from '../helpers/liveViem.js';
import { getCartAddress, resolveCurrency } from '../../src/contracts/addresses.js';

loadDotEnv();

const setup = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY ?? process.env.E2E_SELLER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
  if (!apiBaseUrl || !key || !isHex(key) || key.length !== 66) throw new Error('Set a deployed feature API and registered dedicated test account private key.');
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com') throw new Error('Print integration tests require a non-production HTTPS API.');
  const wallet = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const walletClient = createWalletClient({ account: wallet, chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const rare = createRareClient({ apiBaseUrl, publicClient, walletClient });
  return { wallet, rare, apiBaseUrl, publicClient };
};

describe('print tooling through deployed Rare API', () => {
  it('validates an owned private master and generates a usable asynchronous preview', async () => {
    const { wallet, rare } = setup();
    await rare.auth.loginWithWallet({ address: wallet.address, chainId: sepolia.id,
      signMessage: message => wallet.signMessage({ message }) });
    const bytes = await downloadTestImage();
    const production = await rare.upload(bytes, 'mockup-artwork.jpg', { access: 'private', contentType: 'image/jpeg' });
    const input = { productionUploadKey: production.key, specificationId: 'GLOBAL-FAP-8X12' };
    await expect.poll(async () => {
      try { return (await rare.prints.files.validate(input)).status; }
      catch (error) { if (error instanceof RareApiError && error.status === 409) return undefined; throw error; }
    }, { timeout: 60_000, interval: 2_000 }).toMatch(/^(valid|warning|error)$/u);
    const validation = await rare.prints.files.validate(input);
    expect(validation).toEqual({ valid: expect.any(Boolean), status: expect.stringMatching(/^(valid|warning|error)$/u), issues: expect.any(Array) });
    for (const issue of validation.issues) expect(issue).toEqual(expect.objectContaining({
      code: expect.any(String), message: expect.any(String), severity: expect.stringMatching(/^(warning|error)$/u),
    }));
    const created = await rare.prints.mockups.create(input);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/u);
    await expect.poll(async () => {
      const current = await rare.prints.mockups.get(created.id);
      if (current.status === 'failed') throw new Error(`Print mockup ${created.id} failed at the provider.`);
      return current.status;
    }, { timeout: 120_000, interval: 2_000 }).toBe('completed');
    const completed = await rare.prints.mockups.get(created.id);
    if (completed.result === undefined) throw new Error('Completed print mockup did not return a preview.');
    expect(new URL(completed.result.url).protocol).toBe('https:');
    expect(completed.result.widthPx).toBeGreaterThan(0);
    expect(completed.result.heightPx).toBeGreaterThan(0);
    const image = await fetch(completed.result.url);
    expect(image.ok).toBe(true);
    expect(image.headers.get('content-type')).toMatch(/^image\//u);
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, 180_000);

  it('prepares an unminted artwork Product and resumes its private print without a release manifest', async () => {
    const { wallet, rare, publicClient } = setup();
    await rare.auth.loginWithWallet({ address: wallet.address, chainId: sepolia.id,
      signMessage: message => wallet.signMessage({ message }) });
    let productId: string | undefined;
    let draftId: string | undefined;
    try {
      const catalog = await rare.prints.products.list();
      const specification = catalog.find(product => product.id === 'GLOBAL-FAP-8X12');
      if (specification === undefined) throw new Error('The API returned no supported print product.');
      const collection = await rare.collection.deploy.lazyErc721({ name: 'Prepared artwork', symbol: 'PREP', maxTokens: 1n });
      // Same immutable numbered metadata fixture as CLI blind-release coverage.
      await rare.collection.prepareLazyMint({ contract: collection.contract,
        baseUri: 'ipfs://bafybeifveb3j4ajfqefjrcsyn5q3zdznbf45szryidgwqlqvipidw5foh4/lazy',
        amount: 1n, minter: getCartAddress('sepolia') });
      const sourceUniversalTokenId = `11155111-${collection.contract.toLowerCase()}-1`;
      // Factory registration can create lazy NFT records before ownership exists.
      await expect.poll(async () => {
        try { return (await rare.nft.get({ contract: collection.contract, tokenId: '1' })).universalTokenId; }
        catch (error) { if (error instanceof RareApiError && error.status === 404) return undefined; throw error; }
      }, { timeout: 180_000, interval: 2_000 }).toBe(sourceUniversalTokenId);
      const unmintedOwner = () => publicClient.readContract({ address: collection.contract,
        abi: erc721Abi, functionName: 'ownerOf', args: [1n] });
      await expect(unmintedOwner()).rejects.toThrow(/nonexistent|invalid|reverted/iu);
      const releaseDraftId = randomUUID();
      const product = await rare.cart.catalog.products.create({ metadata: { title: 'Prepared artwork one', releaseDraftId } }, { idempotencyKey: randomUUID() });
      productId = product.id;
      const configured = await rare.cart.catalog.variants.add(product.id, { variants: [{ metadata: { title: 'Planned NFT' },
        plannedNft: { chainId: '11155111', contract: collection.contract, tokenId: '1' } }] });
      expect(configured.variants).toHaveLength(1);
      const preparedVariant = configured.variants[0];
      if (preparedVariant === undefined) throw new Error('Planned NFT variant was not returned.');
      expect(preparedVariant).toMatchObject({ universalTokenId: sourceUniversalTokenId, isHidden: true });
      expect((await rare.cart.catalog.products.listMine({ releaseDraftId })).data.map(candidate => candidate.id)).toContain(product.id);
      const bytes = await downloadTestImage();
      const production = await rare.upload(bytes, 'prepared-artwork.jpg', { access: 'private', contentType: 'image/jpeg' });
      const preview = await rare.upload(bytes, 'prepared-artwork-preview.jpg', { contentType: 'image/jpeg' });
      const draft = await rare.prints.drops.create({ idempotencyKey: randomUUID(), chainId: '11155111', productId: product.id,
        name: 'Prepared artwork print', print: { productionUploadKey: production.key } });
      draftId = draft.id;
      expect(draft.product_id).toBe(product.id);
      expect((await rare.prints.drops.listMine({ productId: product.id })).data.map(candidate => candidate.id)).toContain(draft.id);
      await rare.prints.drops.update(draft.id, { specificationId: specification.id, name: 'Prepared artwork print',
        images: [preview.url], description: 'Prepared before the NFT is minted.', tags: ['sdk-integration'] });
      await rare.prints.options.configure({ dropId: draft.id, input: { displayPriceUsdCents: '1000' } });
      const productBeforeArchive = await rare.cart.catalog.products.publish(product.id);
      const publicProduct = await rare.cart.catalog.products.get(product.id);
      expect(publicProduct.variants.find(variant => variant.sku === preparedVariant.sku)).toMatchObject({ isHidden: true });
      await expect(unmintedOwner()).rejects.toThrow(/nonexistent|invalid|reverted/iu);
      await rare.prints.drops.archive(draft.id);
      draftId = undefined;
      expect((await rare.cart.catalog.products.getMine(product.id)).status).toBe(productBeforeArchive.status);
      expect((await rare.cart.catalog.products.getMine(product.id)).metadata.title).toBe('Prepared artwork one');
    } finally {
      if (draftId !== undefined) await rare.prints.drops.archive(draftId);
      if (productId !== undefined) await rare.cart.catalog.products.archive(productId);
      await rare.auth.logout();
    }
  }, 360_000);

  it('quotes products and configures independently priced print size variants on one Product', async () => {
    const { wallet, rare } = setup();
    await rare.auth.loginWithWallet({ address: wallet.address, chainId: sepolia.id,
      signMessage: message => wallet.signMessage({ message }) });
    let draftIds: string[] = [];
    let productId: string | undefined;
    try {
      const product = await rare.cart.catalog.products.create({ metadata: { title: 'SDK print size variants' } });
      productId = product.id;
      const quote = await rare.prints.quote({ specificationId: 'GLOBAL-FAP-8X12', destinationCountryCode: 'US', copies: 1 });
      expect(quote.currency).toBe('USD');
      expect(BigInt(quote.productionCostUsdCents)).toBeGreaterThan(0n);
      const bytes = await downloadTestImage();
      const production = await rare.upload(bytes, 'variants-production.jpg', { access: 'private', contentType: 'image/jpeg' });
      const preview = await rare.upload(bytes, 'variants-preview.jpg', { contentType: 'image/jpeg' });
      const specifications = [{ id: 'GLOBAL-FAP-8X12', price: '2500' }, { id: 'GLOBAL-FAP-16X24', price: '4000' }];
      const skus: string[] = [];
      for (const specification of specifications) {
        const draft = await rare.prints.drops.create({ idempotencyKey: randomUUID(), productId, chainId: '11155111', name: 'SDK print variant fixture',
          print: { productionUploadKey: production.key, name: 'SDK print variant fixture', images: [preview.url],
            description: 'Unpaid variant configuration.', tags: [], specificationId: specification.id } });
        draftIds = [...draftIds, draft.id];
        const option = await rare.prints.options.configure({ dropId: draft.id, input: { displayPriceUsdCents: specification.price } });
        expect(option.metadata).toMatchObject({ displayPriceUsdCents: specification.price });
        skus.push(option.sku);
        expect((await rare.prints.drops.getMine(draft.id)).product_id).toBe(productId);
      }
      expect(new Set(skus).size).toBe(specifications.length);
    } finally {
      for (const draftId of draftIds) await rare.prints.drops.archive(draftId);
      if (productId !== undefined) await rare.cart.catalog.products.archive(productId);
      await rare.auth.logout();
    }
  }, 180_000);

  it('publishes quantity-limited and gated prints, quotes copies, and reserves an earned claim', async () => {
    const { wallet, rare } = setup();
    const addressId = randomUUID();
    let addressNeedsCleanup = false;
    let dropId: string | undefined;
    await rare.auth.loginWithWallet({ address: wallet.address, chainId: sepolia.id,
      signMessage: message => wallet.signMessage({ message }) });
    try {
      // Fail before uploads or persistent changes when this deployment is missing print tooling.
      const products = await rare.prints.products.list();
      const product = products.find(item => item.id === 'GLOBAL-FAP-8X12');
      if (!product) throw new Error('The API returned no print products.');
      const addressesBefore = await rare.shippingAddresses.list();
      const details = { name: 'SDK fulfillment fixture', email: 'sdk-fixture@example.test', phoneNumber: '+12025550100',
        addressLine1: '123 Test Street', addressLine2: '', townOrCity: 'New York', stateOrCounty: 'NY',
        postalOrZipCode: '10001', countryCode: 'US' };
      const saved = await rare.shippingAddresses.save({ id: addressId, label: 'SDK integration', details, makeDefault: false });
      addressNeedsCleanup = true;
      expect(saved.id).toBe(addressId);
      expect(saved.details).toEqual(details);
      expect((await rare.shippingAddresses.list()).find(address => address.id === addressId)?.details).toEqual(details);
      const bytes = await downloadTestImage();
      const production = await rare.upload(bytes, 'production.jpg', { access: 'private', contentType: 'image/jpeg' });
      expect(production.access).toBe('private');
      expect('url' in production).toBe(false);
      const photo = await rare.upload(bytes, 'preview.jpg', { contentType: 'image/jpeg' });
      const input: CreatePrintDrop = { idempotencyKey: randomUUID(), chainId: '11155111', name: 'SDK print tooling fixture', description: 'Draft only, no purchase or fulfillment.',
        print: { name: 'SDK print tooling fixture', description: 'Draft only, no purchase or fulfillment.', tags: ['sdk-integration'],
          productionUploadKey: production.key, images: [photo.url], specificationId: product.id } };
      const batchCreated = await rare.prints.drops.create([{ key: 'print', input }]);
      const createdResult = batchCreated[0];
      if (createdResult?.status !== 'fulfilled') throw new Error('Batch print creation failed', { cause: createdResult });
      const created = createdResult.value;
      expect(await rare.prints.drops.create([{ key: 'print', input }], { previousResults: batchCreated })).toEqual(batchCreated);
      dropId = created.id;
      expect((await rare.prints.drops.create(input)).id).toBe(created.id);
      expect((await rare.prints.drops.getMine(created.id)).metadata.name).toBe(input.name);
      expect((await rare.prints.drops.listMine({ perPage: 100 })).data.some(drop => drop.id === created.id)).toBe(true);
      await rare.prints.drops.update(created.id, { name: 'Updated SDK print fixture', tags: ['updated-sdk-integration'] });
      expect((await rare.prints.drops.getMine(created.id)).metadata.name).toBe('Updated SDK print fixture');
      const configured = await rare.prints.options.configure([{ key: 'print', input: { dropId: created.id, input: { displayPriceUsdCents: '10000' } } }]);
      if (configured[0]?.status !== 'fulfilled') throw new Error('Batch print configuration failed', { cause: configured });
      const option = configured[0].value;
      const preparationInput = { optionId: option.id, seller: wallet.address,
        listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
        availableQuantity: '10', maxQuantityPerCheckout: '2' } satisfies PreparePrintListing;
      const prepared = await rare.prints.listings.prepare([{ key: 'print', input: preparationInput }]);
      if (prepared[0]?.status !== 'fulfilled') throw new Error('Batch print preparation failed', { cause: prepared });
      const frozen = prepared[0].value;
      expect((await rare.prints.listings.prepare(preparationInput)).id).toBe(frozen.id);
      const published = await rare.cart.listing.publish({ printPreparations: frozen });
      expect((await rare.cart.listing.publish({
        printPreparations: frozen, signedArtifact: published.signedArtifact,
      })).publishedRoot).toEqual(published.publishedRoot);
      expect(published).not.toHaveProperty('approvalTxHash');
      const entry = published.signedArtifact.entries[0];
      if (!entry) throw new Error('Published print Listing returned no Cart entry.');
      const publicDrop = await rare.prints.drops.get(created.id);
      expect(publicDrop.options.find(candidate => candidate.listingDigest === entry.listingDigest)).toMatchObject({
        maxQuantityPerCheckout: '2', eligibilityRuleId: null,
      });
      expect('productionUploadKey' in publicDrop.metadata).toBe(false);
      expect((await rare.prints.drops.activity(created.id)).data).toEqual([]);
      const checkout = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 2n, recipient: wallet.address }], delivery: { savedAddressId: addressId } });
      expect(checkout.breakdown?.displayPrice).toBe(200_000_000n);
      expect(checkout.lines.find(line => line.listingDigest === entry.listingDigest)?.quantity).toBe(2n);
      await expect(rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 3n, recipient: wallet.address }],
        delivery: { savedAddressId: addressId } })).rejects.toMatchObject({ status: 422 });
      expect(checkout.breakdown?.production).toBeGreaterThan(0n);
      expect(checkout.breakdown?.shipping).toBeGreaterThanOrEqual(0n);
      if (!checkout.breakdown) throw new Error('Print checkout requires a cost breakdown.');
      expect(checkout.breakdown.total).toBe(checkout.breakdown.displayPrice + checkout.breakdown.production + checkout.breakdown.shipping + checkout.breakdown.networkFee);
      expect(option.metadata).not.toHaveProperty('productionQuote');
      expect(checkout.breakdown?.total).toBe(checkout.paymentAmount);
      if (!checkout.idempotencyKey || !checkout.intent.delivery) throw new Error('Delivery quote did not retain its idempotency key and delivery intent.');
      const signed = await rare.cart.checkout.authorize(checkout);
      expect((await rare.cart.checkout.authorize(checkout)).executePurchase.order.orderId).toBe(signed.executePurchase.order.orderId);
      expect(signed.executePurchase.order.paymentAmount).toBe(checkout.paymentAmount);
      expect(signed.executePurchase.lines.find(line => line.listingDigest === entry.listingDigest)?.quantity).toBe(2n);
      expect(signed.executePurchase.actions).toEqual([]);
      const changedQuote = await rare.cart.checkout.prepare({ ...checkout.intent, items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 1n, recipient: wallet.address }] });
      await expect(rare.cart.checkout.authorize({ ...changedQuote, idempotencyKey: checkout.idempotencyKey })).rejects.toMatchObject({ status: 409 });
      const orderId = signed.executePurchase.order.orderId;
      const orderDetails = await rare.cart.orders.get(orderId);
      expect(orderDetails.id).toBe(orderId);
      expect(orderDetails.status).toBe('PENDING');
      expect(orderDetails.items).toContainEqual(expect.objectContaining({ listingDigest: entry.listingDigest.toLowerCase(),
        quantity: '2', fulfillmentStatus: 'PENDING', printDropId: created.id, title: expect.any(String), images: expect.arrayContaining([photo.url]) }));
      expect((await findCartOrderInHistory(rare.cart.orders, orderId))?.id).toBe(orderId);
      // A creator may replace the private master on the same published edition.
      // Existing authorizations retain their saved fulfillment snapshot; the backend
      // integration suite verifies private old/new asset references directly.
      const replacementBytes = await downloadTestImage();
      const replacement = await rare.upload(replacementBytes, 'replacement-production.jpg', { access: 'private', contentType: 'image/jpeg' });
      expect(replacement.key).not.toBe(production.key);
      const updatedMaster = await rare.prints.drops.update(created.id, { productionUploadKey: replacement.key });
      expect(updatedMaster.status).toBe('PUBLISHED');
      expect(updatedMaster.metadata.productionUploadKey).toBe(replacement.key);
      expect((await rare.prints.drops.getMine(created.id)).metadata.productionUploadKey).toBe(replacement.key);
      const publicAfterReplacement = await rare.prints.drops.get(created.id);
      expect(publicAfterReplacement.metadata).not.toHaveProperty('productionUploadKey');
      expect(publicAfterReplacement.options.some(candidate => candidate.listingDigest === entry.listingDigest)).toBe(true);
      expect((await rare.cart.checkout.authorize(checkout)).executePurchase.order.orderId).toBe(orderId);
      const futureCheckout = await rare.cart.checkout.prepare({ ...checkout.intent,
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 1n, recipient: wallet.address }] });
      const futureSigned = await rare.cart.checkout.authorize(futureCheckout);
      expect(futureSigned.executePurchase.order.orderId).not.toBe(orderId);
      expect(futureSigned.executePurchase.lines.find(line => line.listingDigest === entry.listingDigest)?.quantity).toBe(1n);
      expect(await rare.cart.orders.get(orderId)).toMatchObject({ status: orderDetails.status, items: orderDetails.items });

      const source = await createCreatorCartScenario({ tokenCount: 1, eligibility: true });
      try {
        const nft = source.listings[0];
        if (!nft) throw new Error('Gated print fixture requires a qualifying NFT.');
        const sourceUniversalTokenId = `11155111-${nft.tokenContract.toLowerCase()}-${nft.tokenId}`;
        const mapped = await rare.prints.drops.create({ ...input, idempotencyKey: randomUUID(),
          print: { ...input.print, sourceUniversalTokenId } });
        try {
          expect(mapped.metadata.sourceUniversalTokenId).toBe(sourceUniversalTokenId);
          expect(mapped).not.toHaveProperty('universal_token_id');
          const mappedOption = await rare.prints.options.configure({ dropId: mapped.id, input: { displayPriceUsdCents: '10000' } });
          const mappedPreparation = await rare.prints.listings.prepare({ optionId: mappedOption.id, seller: wallet.address,
            listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400), availableQuantity: '10' });
          const mappedPublication = await rare.cart.listing.publish({ printPreparations: mappedPreparation });
          const mappedEntry = mappedPublication.signedArtifact.entries[0];
          if (!mappedEntry) throw new Error('Mapped print returned no Listing.');
          expect(mappedEntry.listing.fulfillmentKind).toBe(1);
          const mappedPublic = await rare.prints.drops.get(mapped.id);
          expect(mappedPublic.metadata.sourceUniversalTokenId).toBe(sourceUniversalTokenId);
          expect(mappedPublic).not.toHaveProperty('universalTokenId');
          await expect.poll(async () => (await rare.prints.releases.list({ universalTokenId: sourceUniversalTokenId })).some(drop => drop.id === mapped.id),
            { timeout: 60_000, interval: 2_000 }).toBe(true);
          const nftListing = source.createdListings[0];
          if (!nftListing) throw new Error('Mixed delivery requires a normal ERC-721 Listing.');
          const editions = await rare.collection.deploy.erc1155({ name: `Mixed editions ${randomUUID()}`, symbol: 'MIX', baseUri: '' });
          const edition = await rare.collection.erc1155.createToken({ contract: editions.contract, maxSupply: 10n,
            tokenUri: `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'Mixed edition', image: photo.url }))}` });
          await rare.collection.erc1155.mint({ contract: editions.contract, tokenId: edition.tokenId, quantity: 2n });
          const editionPublication = await rare.cart.listing.publish({ preparation: await rare.cart.listing.prepare({
            seller: wallet.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), listings: [{
              nft: { contract: editions.contract, tokenId: edition.tokenId }, fulfillmentKind: 3,
              settlementCurrency: getAddress(entry.listing.settlementCurrency), unitPrice: 1_000_000n, quantity: 2n,
            }],
          }), autoApprove: true });
          const editionEntry = editionPublication.signedArtifact.entries[0];
          if (!editionEntry) throw new Error('Mixed delivery requires a normal ERC-1155 Listing.');
          const outputAmount = 10_000_000_000_000_000n;
          const batch = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
            items: [
              { kind: 'listing', listingDigest: nftListing.listingDigest, quantity: 1n, recipient: wallet.address },
              { kind: 'listing', listingDigest: entry.listingDigest, quantity: 2n, recipient: wallet.address },
              { kind: 'listing', listingDigest: editionEntry.listingDigest, quantity: 2n, recipient: wallet.address },
              { kind: 'listing', listingDigest: mappedEntry.listingDigest, quantity: 1n, recipient: wallet.address },
              { kind: 'swap', mode: 'exact-output', outputCurrency: resolveCurrency('rare', 'sepolia'), outputAmount, recipient: wallet.address },
            ],
            delivery: { savedAddressId: addressId } });
          if (!batch.intent.delivery || !batch.idempotencyKey) throw new Error('Batch quote lost its delivery identity.');
          expect(batch.intent.items).toHaveLength(5);
          expect(batch.breakdown).toBeUndefined();
          expect(batch.paymentAmount).toBeGreaterThan(0n);
          expect(batch.settlements).toContainEqual({
            currency: getAddress(resolveCurrency('rare', 'sepolia')), amount: outputAmount,
          });
          for (const settlement of batch.settlements) {
            expect(settlement.amount).toBe(batch.lines
              .filter(line => isAddressEqual(line.settlementCurrency, settlement.currency))
              .reduce((total, line) => total + line.amount, 0n));
          }
          const preparedBatch = await rare.cart.checkout.authorize(batch);
          const mixedLines = preparedBatch.executePurchase.lines;
          expect(mixedLines.find(line => line.listingDigest === nftListing.listingDigest)).toMatchObject({ quantity: 1n, fulfillmentKind: 2 });
          expect(mixedLines.find(line => line.listingDigest === editionEntry.listingDigest)).toMatchObject({ quantity: 2n, fulfillmentKind: 3 });
          expect(mixedLines.find(line => line.listingDigest === entry.listingDigest)).toMatchObject({ quantity: 2n, fulfillmentKind: 1 });
          expect(mixedLines.find(line => line.fulfillmentKind === 6)).toMatchObject({ amount: outputAmount });
          expect(preparedBatch.executePurchase.actions.map(action => ({
            quantity: action.quantity, kind: mixedLines[Number(action.lineIndex)]?.fulfillmentKind,
          }))).toEqual(expect.arrayContaining([{ quantity: 1n, kind: 2 }, { quantity: 2n, kind: 3 }]));
          const history = await rare.cart.orders.get(preparedBatch.executePurchase.order.orderId);
          expect(history.status).toBe('PENDING');
          expect(history.items?.every(item => item.fulfillmentStatus === 'PENDING')).toBe(true);
          expect(history.fulfillments).toHaveLength(2);
          expect(new Set(history.fulfillments.map(item => item.orderLineIndex)).size).toBe(2);
          expect(history.fulfillments.map(item => item.orderLineIndex).sort()).toEqual([
            mixedLines.findIndex(line => line.listingDigest === entry.listingDigest),
            mixedLines.findIndex(line => line.listingDigest === mappedEntry.listingDigest),
          ].sort());
          const recovered = await rare.cart.checkout.recover(batch.idempotencyKey);
          expect(recovered.status).toBe('READY');
          expect(recovered.preparedPurchase?.executePurchase.order.orderId).toBe(preparedBatch.executePurchase.order.orderId);
        } finally {
          await rare.prints.drops.archive(mapped.id);
        }
        const rule = await rare.cart.purchaseEligibility.rules.create({ definition: {
          kind: 'EVERY_SALE', source: { chainId: '11155111', tokenContract: nft.tokenContract },
          targets: [{ sku: option.sku }],
        } });
        try {
          const gated = await rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
            listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
            availableQuantity: '10', maxQuantityPerCheckout: '2', eligibilityRuleId: rule.id });
          const gatedPublication = await rare.cart.listing.publish({ printPreparations: gated });
          const gatedEntry = gatedPublication.signedArtifact.entries[0];
          if (!gatedEntry) throw new Error('Gated print publication returned no Listing.');
          expect((await rare.prints.drops.get(created.id)).options.find(candidate => candidate.listingDigest === gatedEntry.listingDigest))
            .toMatchObject({ maxQuantityPerCheckout: '2', eligibilityRuleId: rule.id });
          const gatedQuote = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
            items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 1n, recipient: wallet.address }],
            delivery: { savedAddressId: addressId } });
          if (!gatedQuote.intent.delivery || !gatedQuote.idempotencyKey) throw new Error('Gated quote lost its delivery identity.');
          await expect(rare.cart.checkout.authorize(gatedQuote)).rejects.toMatchObject({ status: 409 });
          expect((await rare.cart.purchaseEligibility.claims.list({ ruleId: rule.id })).data).toEqual([]);
          const buyerKey = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
          if (!buyerKey || !isHex(buyerKey) || buyerKey.length !== 66) throw new Error('Set a registered, funded Sepolia E2E_BUYER_PRIVATE_KEYS wallet.');
          const buyer = privateKeyToAccount(buyerKey);
          if (isAddressEqual(buyer.address, wallet.address)) throw new Error('The print eligibility buyer must differ from the creator.');
          const buyerRare = createRareClient({ apiBaseUrl: source.apiBaseUrl,
            publicClient: source.publicClient, walletClient: createWalletClient({ account: buyer,
              chain: sepolia, transport: http(getTestRpcUrl()) }) });
          await buyerRare.auth.loginWithWallet({ address: buyer.address, chainId: sepolia.id,
            signMessage: message => buyer.signMessage({ message }) });
          try {
            const sourceListing = source.createdListings[0];
            if (!sourceListing) throw new Error('Qualifying NFT has no published Listing.');
            const sourceQuote = await buyerRare.cart.checkout.prepare({ paymentCurrency: zeroAddress,
              items: [{ kind: 'listing', listingDigest: sourceListing.listingDigest, quantity: 1n, recipient: buyer.address }] });
            expect(sourceQuote.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
            expect((await buyerRare.cart.checkout.purchase({ preparation: sourceQuote })).receipt.status).toBe('success');
            const claims = () => buyerRare.cart.purchaseEligibility.claims.list({ ruleId: rule.id, perPage: 100 }).then(page => page.data);
            await expect.poll(claims, { timeout: 180_000, interval: 2_000 }).toMatchObject([{ status: 'AVAILABLE' }]);
            const twoCopies = await buyerRare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
              items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 2n, recipient: buyer.address }],
              delivery: { recipientDetails: details } });
            if (!twoCopies.intent.delivery || !twoCopies.idempotencyKey) throw new Error('Multi-copy quote lost its delivery identity.');
            await expect(buyerRare.cart.checkout.authorize(twoCopies)).rejects.toMatchObject({ status: 409 });
            expect(await claims()).toMatchObject([{ status: 'AVAILABLE' }]);
            const buyerQuote = await buyerRare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
              items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 1n, recipient: buyer.address }],
              delivery: { recipientDetails: details } });
            if (!buyerQuote.intent.delivery || !buyerQuote.idempotencyKey) throw new Error('Eligible print quote lost its delivery identity.');
            const reserved = await buyerRare.cart.checkout.authorize(buyerQuote);
            expect((await buyerRare.cart.checkout.authorize(buyerQuote)).executePurchase.order.orderId)
              .toBe(reserved.executePurchase.order.orderId);
            expect(await claims()).toMatchObject([{ status: 'RESERVED' }]);
            // The qualifying NFT was purchased; the print Order remains unpaid and expires safely.
          } finally {
            await buyerRare.auth.logout();
          }
        } finally {
          await rare.cart.purchaseEligibility.rules.disable(rule.id);
        }
      } finally {
        await source.rare.auth.logout();
      }
      expect(entry.listing.fulfillmentKind).toBe(1);
      expect(entry.listing.tokenContract).toBe(zeroAddress);
      expect(entry.listing.tokenId).toBe('0');
      // No purchase call: the prepared order expires without payment or provider submission.
      const anonymous = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http() }),
        apiBaseUrl: process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL });
      await expect(anonymous.prints.drops.getMine(created.id)).rejects.toThrow();
      expect((await rare.prints.drops.archive(created.id)).status).toBe('ARCHIVED');
      dropId = undefined;
      const remaining = await rare.shippingAddresses.delete(addressId);
      addressNeedsCleanup = false;
      expect(remaining).toBeUndefined();
      expect(await rare.shippingAddresses.list()).toEqual(addressesBefore);
    } finally {
      if (dropId !== undefined) await rare.prints.drops.archive(dropId);
      if (addressNeedsCleanup) await rare.shippingAddresses.delete(addressId);
      await rare.auth.logout();
    }
  }, 600_000);
});
