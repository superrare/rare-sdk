import type { PrintListingPreparation } from './prints.js';
import type { CartOrdersNamespace } from './orders.js';
import type { Account, Address, Hash, Hex, TransactionReceipt } from 'viem';
import type {
  CartApiListingRoot, CartApiNamespace, CartApiPreparedPurchase, CartCheckoutIntent,
  CartCheckoutPreparation, CartListingIntent, CartDeliveryCheckout,
  CartCheckoutQuote, CartCheckoutRecovery, CartCheckoutReceipt, CartCardCheckout,
} from './cart-api.js';
import type { CartRoutingNamespace } from './cart-routing.js';
import type { PurchaseEligibilityNamespace } from './eligibility.js';

export const cartFulfillmentKinds = {
  none: 0,
  offChain: 1,
  erc721Transfer: 2,
  erc1155Transfer: 3,
  erc721MintTo: 4,
  erc1155MintTo: 5,
  currencySwap: 6,
} as const;
export type CartFulfillmentKind = (typeof cartFulfillmentKinds)[keyof typeof cartFulfillmentKinds];
export type CartSellerFulfillmentKind =
  | typeof cartFulfillmentKinds.erc721Transfer
  | typeof cartFulfillmentKinds.erc1155Transfer
  | typeof cartFulfillmentKinds.erc721MintTo
  | typeof cartFulfillmentKinds.erc1155MintTo;

export type CartSplit = { recipient: Address; basisPoints: number };

export type CartListing = {
  listingSalt: Hex; seller: Address; sku: Hex; fulfillmentKind: CartFulfillmentKind;
  tokenContract: Address; tokenId: bigint; settlementCurrency: Address;
  minimumUnitPrice: bigint; availableQuantity: bigint; paymentRecipient: Address; splits: CartSplit[];
};
export type CartListingInput = Omit<CartListing, 'listingSalt' | 'splits'> & { listingSalt?: Hex; splits?: CartSplit[] };
export type CartListingRoot = { listingsRoot: Hex; nonce: bigint; deadline: bigint };
export type CartOrderLine = {
  sku: Hex; listingDigest: Hex; fulfillmentKind: CartFulfillmentKind; quantity: bigint;
  settlementCurrency: Address; amount: bigint; paymentRecipient: Address;
};
export type CartPayoutRoute = { commands: Hex; inputs: Hex[]; routerValue: bigint };
export type CartRouteLeg =
  | { protocol: 'v2'; mode: 'exact-output'; path: Address[]; amountOut: bigint; amountInMaximum: bigint }
  | { protocol: 'v2'; mode: 'exact-input'; path: Address[]; amountIn: bigint; amountOutMinimum: bigint }
  | { protocol: 'v3'; mode: 'exact-output'; path: Address[]; fees: number[]; amountOut: bigint; amountInMaximum: bigint }
  | { protocol: 'v3'; mode: 'exact-input'; path: Address[]; fees: number[]; amountIn: bigint; amountOutMinimum: bigint };
export type BuildCartRouteParams = { paymentCurrency: Address; legs: CartRouteLeg[]; routerValue?: bigint };
export type CartFulfillmentAction = { lineIndex: bigint; quantity: bigint; recipient: Address };
export type CartPurchaseOrder = {
  orderId: Hex; paymentCurrency: Address; deadline: bigint; paymentAmount: bigint; spreadRecipient: Address;
  orderLinesHash: Hex; payoutRouteHash: Hex; fulfillmentActionsHash: Hex;
};
export type CartListingRootArtifactEntry = {
  listing: Omit<CartListing, 'tokenId' | 'minimumUnitPrice' | 'availableQuantity'> & {
    tokenId: string; minimumUnitPrice: string; availableQuantity: string;
  };
  listingDigest: Hex; leaf: Hex; proof: Hex[];
};
export type CartListingRootArtifact = {
  version: 1; type: 'rare-cart-listing-root'; chainId: number; cart: Address; seller: Address;
  root: { listingsRoot: Hex; nonce: string; deadline: string };
  entries: CartListingRootArtifactEntry[]; signature?: Hex;
};
export type CartListingSelection = { artifact: CartListingRootArtifact; listingDigest: Hex };
export type CartListingAuthorizationBundle = {
  listings: CartListing[];
  authorization: CartListingPurchaseAuthorization;
};
export type CartListingPurchaseAuthorization = {
  listingRoots: CartListingRoot[]; listingRootSignatures: Hex[];
  listingRootIndexes: bigint[]; listingProofs: Hex[][];
};
export type CartSignedOrder = {
  order: CartPurchaseOrder; lines: CartOrderLine[]; route: CartPayoutRoute;
  actions: CartFulfillmentAction[]; platformSignature: Hex;
};
export type CartTypedDataSigner = {
  address: Account['address'];
  signTypedData: NonNullable<Account['signTypedData']>;
};

export type BuildCartListingRootParams = {
  listings: CartListing[]; chainId: number; cart: Address; nonce: bigint; deadline: bigint;
};
export type BuildCartListingRootInput = Omit<BuildCartListingRootParams, 'listings'> & {
  listings: CartListingInput[];
};
export type BuildCartOrderParams = {
  orderId: Hex; paymentCurrency: Address; deadline: bigint; paymentAmount: bigint; spreadRecipient: Address;
  lines: CartOrderLine[]; route?: CartPayoutRoute; actions?: CartFulfillmentAction[];
};
export type CartCheckoutParams = CartSignedOrder & {
  listings: CartListing[]; authorization: CartListingPurchaseAuthorization; autoApprove?: boolean;
};
export type CartCheckoutResult = {
  txHash: Hash; receipt: TransactionReceipt; approvalTxHash?: Hash; orderId: Hex; payer: Address;
  paymentCurrency: Address; paymentAmount: bigint; lineCount: number; actionCount: number;
};
export type CartPayParams = { quote: CartCheckoutQuote; onAttempt?: (attemptId: string) => void | Promise<void> } & (
  | { method: 'wallet'; autoApprove?: boolean; onAuthorized?: (purchase: CartApiPreparedPurchase) => void | Promise<void> }
  | { method: 'card'; email: string; attemptId?: string }
);
export type CartPaymentStart =
  | { method: 'wallet'; attemptId: string; purchase: CartPurchaseResult }
  | { method: 'card'; attemptId: string; session: CartCardCheckout };
export type CartPaymentResume = Pick<CartCheckoutRecovery, 'status' | 'orderId'> & { receipt?: CartCheckoutReceipt };

export type CartPurchaseParams = { preparation: CartCheckoutPreparation; autoApprove?: boolean };
/** Resume the original saved reference or delivery draft without submitting payment. */
export type CartCheckoutAuthorization = CartCheckoutPreparation | CartDeliveryCheckout | { preparationReference: string };
export type CartPurchaseResult = CartCheckoutResult & {
  preparation: CartCheckoutPreparation;
  preparedPurchase: CartApiPreparedPurchase;
};
export type CartListingPreparation = {
  intent: CartListingIntent;
  artifact: CartListingRootArtifact;
  requiredApprovals: Address[];
};
export type CartListingPublishParams = {
  preparation: CartListingPreparation;
  autoApprove?: boolean;
  signedArtifact?: CartListingRootArtifact & { signature: Hex };
  /** Persist the exact authorization before publication; rejection prevents submission. */
  onSigned?: (artifact: CartListingRootArtifact & { signature: Hex }) => void | Promise<void>;
};
export type CartPrintListingPublishParams = Omit<CartListingPublishParams, 'preparation'> & (
  | { printPreparations: PrintListingPreparation | readonly PrintListingPreparation[]; printPreparationId?: never }
  | { printPreparationId: string; printPreparations?: never }
);
export type CartListingPublishResult = {
  preparation: CartListingPreparation;
  signedArtifact: CartListingRootArtifact & { signature: Hex };
  publishedRoot: CartApiListingRoot;
  approvalTxHashes: Hash[];
  approvalReceipts: TransactionReceipt[];
};
export type CartValidationIssue = { code: string; field: string; message: string };
export type CartValidationResult<T> = { isValid: true; value: T } | { isValid: false; issues: CartValidationIssue[] };

export type CartNamespace = {
  purchaseEligibility: PurchaseEligibilityNamespace;
  orders: CartOrdersNamespace;
  catalog: {
    products: CartApiNamespace['catalog']['products'];
    variants: CartApiNamespace['catalog']['variants'];
  };
  approval: {
    status: (params: { contract: Address; owner: Address }) => Promise<boolean>;
    approve: (params: { contract: Address }) => Promise<{ txHash?: Hash; receipt?: TransactionReceipt }>;
    revoke: (params: { contract: Address }) => Promise<{ txHash?: Hash; receipt?: TransactionReceipt }>;
  };
  routing: CartRoutingNamespace;
  listing: {
    prepare: (intent: CartListingIntent) => Promise<CartListingPreparation>;
    publish: {
      (params: CartListingPublishParams): Promise<CartListingPublishResult>;
      (params: CartPrintListingPublishParams): Promise<Omit<CartListingPublishResult, 'preparation'>>;
    };
    search: CartApiNamespace['listing']['search'];
    get: CartApiNamespace['listing']['get'];
    invalidate: CartApiNamespace['listing']['invalidate'];
    cancel: (listingDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    cancelRoot: (rootDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    invalidateNonce: () => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
  };
  checkout: {
    /** Price a checkout without creating a payment attempt. */
    quote: (intent: CartCheckoutIntent, options?: {
      /** Read the existing preparation details for advanced checkout displays. */
      onPrepared?: (preparation: CartCheckoutPreparation) => void;
    }) => Promise<CartCheckoutQuote>;
    /** Use a quote from this client. onAttempt can persist the reference before payment starts. */
    pay: (params: CartPayParams) => Promise<CartPaymentStart>;
    /** Observe a previously started attempt without submitting payment. */
    resume: (attemptId: string) => Promise<CartPaymentResume>;
    receipt: CartApiNamespace['checkout']['receipt'];
    recover: CartApiNamespace['checkout']['recover'];
    /** Authorizes a reviewed quote and reserves any required claims, without paying. */
    authorize: (input: CartCheckoutAuthorization) => Promise<CartApiPreparedPurchase>;
    prepare: (intent: CartCheckoutIntent) => Promise<CartCheckoutPreparation>;
    payment: CartApiNamespace['checkout']['payment'];
    paymentMethods: CartApiNamespace['checkout']['paymentMethods'];
    card: CartApiNamespace['checkout']['card'];
    purchase: (params: CartPurchaseParams) => Promise<CartPurchaseResult>;
    execute: (params: CartCheckoutParams) => Promise<CartCheckoutResult>;
  };
};
