import { concatHex, decodeAbiParameters, encodeAbiParameters, isAddressEqual, parseAbiParameters, size, type Address, type Hex } from 'viem';
import { ETH_ADDRESS } from '../contracts/addresses.js';
import { CartRoutingCoreError } from './cart-routing-core.js';

const sender: Address = '0x0000000000000000000000000000000000000001';
const routerAlias: Address = '0x0000000000000000000000000000000000000002';
type Program = { commands: Hex; inputs: Hex[] };

/** Translate provider endpoints to equivalent router aliases before signing. */
export function normalizeCartRouterProgram(program: Program, cart: Address, router: Address, paymentCurrency: Address): Program {
  if (size(program.commands) !== program.inputs.length) throw new CartRoutingCoreError('cart_incompatible_route', 'Cart command and input counts must match.');
  const recipient = (address: Address, allowRouter = false): Address => {
    if (isAddressEqual(address, sender) || isAddressEqual(address, cart)) return sender;
    if (allowRouter && (isAddressEqual(address, routerAlias) || isAddressEqual(address, router))) return routerAlias;
    throw new CartRoutingCoreError('cart_incompatible_route', 'Cart routes must return assets to MSG_SENDER.');
  };
  const parts = program.inputs.flatMap((input, index): Program[] => {
    const command = program.commands.slice(2 + index * 2, 4 + index * 2);
    const commands = concatHex(['0x', `0x${command}`]);
    try {
      if (command === '00' || command === '01') {
        const parameters = parseAbiParameters('address,uint256,uint256,bytes,bool');
        const [target, first, second, path, payer] = decodeAbiParameters(parameters, input);
        if (size(path) < 43 || (size(path) - 20) % 23 !== 0) throw new Error('Invalid V3 path.');
        return [{ commands, inputs: [encodeAbiParameters(parameters, [recipient(target, true), first, second, path, payer])] }];
      }
      if (command === '08' || command === '09') {
        const parameters = parseAbiParameters('address,uint256,uint256,address[],bool');
        const [target, first, second, path, payer] = decodeAbiParameters(parameters, input);
        if (path.length < 2) throw new Error('Invalid V2 path.');
        return [{ commands, inputs: [encodeAbiParameters(parameters, [recipient(target, true), first, second, path, payer])] }];
      }
      if (command === '02') {
        const parameters = parseAbiParameters('address,address,uint160');
        const [token, target, amount] = decodeAbiParameters(parameters, input);
        if (!isAddressEqual(target, router) && !isAddressEqual(target, routerAlias)) throw new Error('Permit2 must prefund the router.');
        return [{ commands, inputs: [encodeAbiParameters(parameters, [token, routerAlias, amount])] }];
      }
      if (command === '04') {
        const parameters = parseAbiParameters('address,address,uint256');
        const [token, target, minimum] = decodeAbiParameters(parameters, input);
        const destination = recipient(target);
        if (isAddressEqual(paymentCurrency, ETH_ADDRESS) && isAddressEqual(token, ETH_ADDRESS)) {
          if (minimum !== 0n) throw new Error('Native refund minimum must be zero.');
          // All obligations share msg.value. Sweeping earlier would remove the
          // native input reserved for subsequent swaps. Refund once at the end.
          return [];
        }
        return [{ commands, inputs: [encodeAbiParameters(parameters, [token, destination, minimum])] }];
      }
      if (command === '0b' || command === '0c') {
        const parameters = parseAbiParameters('address,uint256');
        const [target, amount] = decodeAbiParameters(parameters, input);
        return [{ commands, inputs: [encodeAbiParameters(parameters, [recipient(target, true), amount])] }];
      }
      if (command === '10') {
        const [actions, parameters] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), input);
        if (!/^0x0[6-9]0[bc]0[ef]$/u.test(actions) || parameters.length !== 3) throw new Error('Unsupported V4 action sequence.');
        // Preserve settlement amounts, sentinels and payer flags. Only map equivalent recipients.
        decodeAbiParameters(parseAbiParameters(actions.slice(4, 6) === '0b' ? 'address,uint256,bool' : 'address,uint256'), parameters[1]!);
        const normalized = parameters.map((parameter, position) => {
          if (position !== 2) return parameter;
          if (actions.slice(6, 8) === '0f') {
            decodeAbiParameters(parseAbiParameters('address,uint256'), parameter);
            return parameter;
          }
          const takeParameters = parseAbiParameters('address,address,uint256');
          const [currency, target, amount] = decodeAbiParameters(takeParameters, parameter);
          return encodeAbiParameters(takeParameters, [currency, recipient(target), amount]);
        });
        return [{ commands, inputs: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [actions, normalized])] }];
      }
      throw new Error('Unsupported router command.');
    } catch (error) {
      if (error instanceof CartRoutingCoreError) throw error;
      throw new CartRoutingCoreError('cart_incompatible_route', `Invalid Cart router command ${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { commands: concatHex(parts.map(part => part.commands)), inputs: parts.flatMap(part => part.inputs) };
}

/** Native funding arrives for the entire route, so append exactly one final refund. */
export function appendCartNativeRefund(program: Program, paymentCurrency: Address): Program {
  if (!isAddressEqual(paymentCurrency, ETH_ADDRESS) || size(program.commands) === 0) return program;
  return {
    commands: concatHex([program.commands, '0x04']),
    inputs: [...program.inputs, encodeAbiParameters(parseAbiParameters('address,address,uint256'), [ETH_ADDRESS, sender, 0n])],
  };
}
