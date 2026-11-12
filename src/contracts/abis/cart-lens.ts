// Generated from superrare/core 042bcd74143986629eaf7f45d683e4df3af23b3e.
export const cartLensAbi = [
  {
    "type": "function",
    "name": "listingStatus",
    "inputs": [
      {
        "name": "cart",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "listing",
        "type": "tuple",
        "internalType": "struct ICart.Listing",
        "components": [
          {
            "name": "listingSalt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "seller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sku",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "fulfillmentKind",
            "type": "uint8",
            "internalType": "enum ICart.FulfillmentKind"
          },
          {
            "name": "tokenContract",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "settlementCurrency",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minimumUnitPrice",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "availableQuantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymentRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "splits",
            "type": "tuple[]",
            "internalType": "struct ICart.Split[]",
            "components": [
              {
                "name": "recipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "basisPoints",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          }
        ]
      },
      {
        "name": "root",
        "type": "tuple",
        "internalType": "struct ICart.ListingRoot",
        "components": [
          {
            "name": "listingsRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "status",
        "type": "tuple",
        "internalType": "struct ICartLens.ListingStatus",
        "components": [
          {
            "name": "currentNonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "filledQuantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "remainingQuantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "uncapped",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "nonceValid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "deadlineValid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "cancelled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewRoute",
    "inputs": [
      {
        "name": "cart",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "route",
        "type": "tuple",
        "internalType": "struct ICart.PayoutRoute",
        "components": [
          {
            "name": "commands",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "inputs",
            "type": "bytes[]",
            "internalType": "bytes[]"
          },
          {
            "name": "routerValue",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "preview",
        "type": "tuple",
        "internalType": "struct ICartLens.RoutePreview",
        "components": [
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "code",
            "type": "uint8",
            "internalType": "enum ICartLens.ValidationCode"
          },
          {
            "name": "reason",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validateListing",
    "inputs": [
      {
        "name": "cart",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "listing",
        "type": "tuple",
        "internalType": "struct ICart.Listing",
        "components": [
          {
            "name": "listingSalt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "seller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sku",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "fulfillmentKind",
            "type": "uint8",
            "internalType": "enum ICart.FulfillmentKind"
          },
          {
            "name": "tokenContract",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "settlementCurrency",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "minimumUnitPrice",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "availableQuantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymentRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "splits",
            "type": "tuple[]",
            "internalType": "struct ICart.Split[]",
            "components": [
              {
                "name": "recipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "basisPoints",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          }
        ]
      },
      {
        "name": "root",
        "type": "tuple",
        "internalType": "struct ICart.ListingRoot",
        "components": [
          {
            "name": "listingsRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "rootSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "proof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "requestedQuantity",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct ICartLens.ValidationResult",
        "components": [
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "code",
            "type": "uint8",
            "internalType": "enum ICartLens.ValidationCode"
          },
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subject",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reason",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validatePurchaseEnvelope",
    "inputs": [
      {
        "name": "cart",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "order",
        "type": "tuple",
        "internalType": "struct ICart.PurchaseOrder",
        "components": [
          {
            "name": "orderId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymentCurrency",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "deadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymentAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spreadRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "orderLinesHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payoutRouteHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "fulfillmentActionsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "lines",
        "type": "tuple[]",
        "internalType": "struct ICart.OrderLine[]",
        "components": [
          {
            "name": "sku",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "listingDigest",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "fulfillmentKind",
            "type": "uint8",
            "internalType": "enum ICart.FulfillmentKind"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "settlementCurrency",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "paymentRecipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "route",
        "type": "tuple",
        "internalType": "struct ICart.PayoutRoute",
        "components": [
          {
            "name": "commands",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "inputs",
            "type": "bytes[]",
            "internalType": "bytes[]"
          },
          {
            "name": "routerValue",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "actions",
        "type": "tuple[]",
        "internalType": "struct ICart.FulfillmentAction[]",
        "components": [
          {
            "name": "lineIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "platformSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct ICartLens.ValidationResult",
        "components": [
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "code",
            "type": "uint8",
            "internalType": "enum ICartLens.ValidationCode"
          },
          {
            "name": "index",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "subject",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reason",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "stateMutability": "view"
  }
] as const;
