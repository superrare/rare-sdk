// Generated from superrare/core 593f13bf465b43c2ace4f37fe246b704c16d30a4.
export const cartHashesAbi = [
  {
    "type": "function",
    "name": "hashFulfillmentActions",
    "inputs": [
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashListing",
    "inputs": [
      {
        "name": "domainSeparator",
        "type": "bytes32",
        "internalType": "bytes32"
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashListingLeaf",
    "inputs": [
      {
        "name": "listingDigest",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashListingRoot",
    "inputs": [
      {
        "name": "domainSeparator",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashOrder",
    "inputs": [
      {
        "name": "domainSeparator",
        "type": "bytes32",
        "internalType": "bytes32"
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashOrderLines",
    "inputs": [
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "hashPayoutRoute",
    "inputs": [
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  }
] as const;
