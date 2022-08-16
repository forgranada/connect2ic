import { IC } from "@astrox/connection"
import type { IDL } from "@dfinity/candid"
import type { ActorSubclass, Identity } from "@dfinity/agent"
import {
  PermissionsType,
} from "@astrox/connection/lib/esm/types"
import type {
  SignerResponseSuccess,
  TransactionResponseFailure,
  TransactionResponseSuccess,
} from "@astrox/connection/lib/esm/types"
import type { IConnector, IWalletConnector } from "./connectors"
// @ts-ignore
import astroXLogoLight from "../assets/astrox_light.svg"
// @ts-ignore
import astroXLogoDark from "../assets/astrox.png"
import {
  ok,
  err, Result,
} from "neverthrow"
import { BalanceError, ConnectError, CreateActorError, DisconnectError, InitError, TransferError } from "./connectors"

const balanceFromString = (balance: string, decimal = 8): bigint => {
  const list = balance.split(".")
  const aboveZero = list[0]
  const aboveZeroBigInt = BigInt(aboveZero) * BigInt(1 * 10 ** decimal)
  let belowZeroBigInt = BigInt(0)
  const belowZero = list[1]
  if (belowZero !== undefined) {
    belowZeroBigInt = BigInt(
      belowZero.substring(0, decimal).padEnd(decimal, "0"),
    )
  }
  return aboveZeroBigInt + belowZeroBigInt
}

class AstroX implements IConnector, IWalletConnector {

  public meta = {
    features: ["wallet"],
    icon: {
      light: astroXLogoLight,
      dark: astroXLogoDark,
    },
    id: "astrox",
    name: "AstroX ME",
  }

  #config: {
    whitelist: Array<string>,
    providerUrl: string,
    ledgerCanisterId: string,
    ledgerHost?: string,
    host: string,
    dev: boolean,
  }
  #identity?: Identity
  #principal?: string
  #ic?: IC

  // set config(config) {
  //   this.#config = config
  // }

  get principal() {
    return this.#principal
  }

  constructor(userConfig = {}) {
    this.#config = {
      whitelist: [],
      providerUrl: "https://63k2f-nyaaa-aaaah-aakla-cai.raw.ic0.app",
      ledgerCanisterId: "ryjl3-tyaaa-aaaaa-aaaba-cai",
      ledgerHost: "https://boundary.ic0.app/",
      host: window.location.origin,
      dev: true,
      ...userConfig,
    }
  }

  set config(config) {
    this.#config = { ...this.#config, ...config }
  }

  get config() {
    return this.#config
  }

  async init() {
    try {
      const ic = await IC.create({
        useFrame: !(window.innerWidth < 768),
        signerProviderUrl: `${this.#config.providerUrl}/#signer`,
        walletProviderUrl: `${this.#config.providerUrl}/#transaction`,
        identityProvider: `${this.#config.providerUrl}/#authorize`,
        permissions: [PermissionsType.identity, PermissionsType.wallet],
        ledgerCanisterId: this.#config.ledgerCanisterId,
        ledgerHost: this.#config.ledgerHost,
        dev: this.#config.dev,
      })
      this.#ic = (window.ic.astrox as IC) ?? ic
      this.#principal = this.#ic.principal.toText()
      // TODO: export Identity from @astrox/connection
      // @ts-ignore
      this.#identity = this.#ic.identity
      const isConnected = await this.isConnected()
      if (isConnected) {
        // @ts-ignore
        this.#identity = this.#ic.identity
        this.#principal = this.#ic.principal.toText()
      }
      return ok({ isConnected })
    } catch (e) {
      console.error(e)
      return err({ kind: InitError.InitFailed })
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      if (!this.#ic) {
        return false
      }
      return await this.#ic.isAuthenticated()
    } catch (e) {
      console.error(e)
      return false
    }
  }

  // TODO: export & use types from astrox/connection instead of dfinity/agent
  async createActor<Service>(canisterId: string, idlFactory: IDL.InterfaceFactory): Promise<Result<ActorSubclass<Service>, { kind: CreateActorError; }>> {
    try {
      // TODO: support per actor configuration
      if (this.#config.dev) {
        return err({ kind: CreateActorError.LocalActorsNotSupported })
      }
      if (!this.#ic) {
        return err({ kind: CreateActorError.NotInitialized })
      }
      // @ts-ignore
      const actor = this.#ic.createActor<Service>(idlFactory, canisterId)
      // @ts-ignore
      return ok(actor)
    } catch (e) {
      console.error(e)
      return err({ kind: CreateActorError.CreateActorFailed })
    }
  }

  async connect() {
    try {
      if (!this.#ic) {
        return err({ kind: ConnectError.NotInitialized })
      }
      await this.#ic.connect({
        useFrame: !(window.innerWidth < 768),
        signerProviderUrl: `${this.#config.providerUrl}/#signer`,
        walletProviderUrl: `${this.#config.providerUrl}/#transaction`,
        identityProvider: `${this.#config.providerUrl}/#authorize`,
        permissions: [PermissionsType.identity, PermissionsType.wallet],
        ledgerCanisterId: this.#config.ledgerCanisterId,
        ledgerHost: this.#config.ledgerHost,
      })
      this.#principal = this.#ic.principal.toText()
      // @ts-ignore
      this.#identity = this.#ic.identity
      return ok(true)
    } catch (e) {
      console.error(e)
      return err({ kind: ConnectError.ConnectFailed })
    }
  }

  async disconnect() {
    try {
      await this.#ic?.disconnect()
      return ok(true)
    } catch (e) {
      console.error(e)
      return err({ kind: DisconnectError.DisconnectFailed })
    }
  }

  address() {
    return {
      principal: this.#principal,
      // accountId: this.#ic.accountId,
    }
  }

  async requestTransfer({
                          amount,
                          to,
                          // TODO: why is this needed?
                        }: { amount: number, to: string }) {
    try {
      const result = await this.#ic?.requestTransfer({
        amount: balanceFromString(String(amount)),
        to,
        // TODO: ?
        sendOpts: {},
      })
      // TODO: why string? check astrox-js
      if (typeof result === "string") {
        return err({ kind: TransferError.FaultyAddress })
      }
      if (!result) {
        // ??
        return err({ kind: TransferError.TransferFailed })
      }
      switch (result?.kind) {
        case "transaction-client-success":
          return ok({
            // TODO: why is payload optional? check astrox-js
            height: Number(result.payload?.blockHeight),
          })
        default:
          return err({ kind: TransferError.TransferFailed })
      }
    } catch (e) {
      console.error(e)
      return err({ kind: TransferError.TransferFailed })
    }
  }

  async queryBalance() {
    try {
      const ICPBalance = Number(await this.#ic?.queryBalance()) ?? 0
      return ok([{
        amount: ICPBalance / 100000000,
        canisterId: this.#config.ledgerCanisterId,
        decimals: 8,
        // TODO: fix
        image: "Dfinity.svg",
        name: "ICP",
        symbol: "ICP",
      }])
    } catch (e) {
      console.error(e)
      return err({ kind: BalanceError.QueryBalanceFailed })
    }
  }

  // async signMessage({ message }: { message: string }): Promise<SignerResponseSuccess | string | undefined> {
  //   return this.#ic?.signMessage({
  //     signerProvider: this.#config.providerUrl,
  //     message,
  //   })
  // }

  // getManagementCanister: (...args) => this.#ic.getManagementCanister(...args),
  // batchTransactions: (...args) => this.#ic.batchTransactions(...args),
}

export {
  AstroX,
}