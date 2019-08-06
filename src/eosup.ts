/// <reference types="../@types/types" />

import fs from 'fs'
import path from 'path'

import { Api, JsonRpc, Serialize } from 'eosjs'
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig'
import fetch from 'node-fetch'
import { TextDecoder, TextEncoder } from 'util'

import Compiler from './compiler'

export default class EosUp {
  public static keypair = {
    public: 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV',
    private: '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
  }

  public static async compile({
    printOutput,
    input,
    output,
    contract,
    extraParams
  }: {
    printOutput?: boolean
    input: string
    output: string
    contract?: string
    extraParams?: string
  }) {
    await Compiler.compile({
      printOutput,
      input,
      output,
      contract,
      extraParams
    })
  }

  public eos: Api

  constructor({ eos }: { eos?: Api } = {}) {
    if (eos) {
      this.eos = eos
    } else {
      const signatureProvider = new JsSignatureProvider([EosUp.keypair.private])
      const rpc = new JsonRpc('http://localhost:8888', { fetch })
      this.eos = new Api({
        rpc,
        signatureProvider,
        textEncoder: new TextEncoder() as any,
        textDecoder: new TextDecoder() as any
      })
    }
  }

  public async createAccount(name: string, publicKey = EosUp.keypair.public) {
    const auth = {
      threshold: 1,
      keys: [{ weight: 1, key: publicKey }],
      accounts: [],
      waits: []
    }
    return this.eos.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'newaccount',
            authorization: [
              {
                actor: 'eosio',
                permission: 'active'
              }
            ],
            data: {
              creator: 'eosio',
              name,
              owner: auth,
              active: auth
            }
          }
        ]
      },
      { blocksBehind: 0, expireSeconds: 60 }
    )
  }

  public async setContract(account: string, contractPath: string) {
    const wasm = fs.readFileSync(contractPath)
    const abiBuffer = fs.readFileSync(
      path.format({
        ...path.parse(contractPath),
        ext: '.abi',
        base: undefined
      })
    )

    const abi: { [key: string]: any } = JSON.parse((abiBuffer as any) as string)
    const abiDefinition = this.eos.abiTypes.get('abi_def')
    if (!abiDefinition) {
      throw new Error('Missing ABI definition')
    }

    for (const { name: field } of abiDefinition.fields) {
      if (!(field in abi)) {
        abi[field] = []
      }
    }

    const buffer = new Serialize.SerialBuffer({
      textEncoder: this.eos.textEncoder,
      textDecoder: this.eos.textDecoder
    })
    abiDefinition.serialize(buffer, abi)

    return this.eos.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'setcode',
            authorization: [
              {
                actor: account,
                permission: 'active'
              }
            ],
            data: {
              account,
              vmtype: 0,
              vmversion: 0,
              code: wasm
            }
          },
          {
            account: 'eosio',
            name: 'setabi',
            authorization: [
              {
                actor: account,
                permission: 'active'
              }
            ],
            data: {
              account,
              abi: buffer.asUint8Array()
            }
          }
        ]
      },
      { blocksBehind: 0, expireSeconds: 60 }
    )
  }

  public async hasCodeActivePermission(account: string, contract: string) {
    const auth = (await this.eos.rpc.get_account(account)).permissions.find(
      (p: any) => p.perm_name === 'active'
    ).required_auth
    const entry = auth.accounts.find(
      (a: any) =>
        a.permission.actor === contract &&
        a.permission.permission === 'eosio.code' &&
        a.weight >= auth.threshold
    )
    return !!entry
  }

  public async giveCodeActivePermission(account: string, contract: string) {
    const auth = (await this.eos.rpc.get_account(account)).permissions.find(
      (p: any) => p.perm_name === 'active'
    ).required_auth
    auth.accounts.push({
      permission: { actor: contract, permission: 'eosio.code' },
      weight: auth.threshold
    })
    return this.eos.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'updateauth',
            authorization: [
              {
                actor: account,
                permission: 'active'
              }
            ],
            data: {
              account,
              permission: 'active',
              parent: 'owner',
              auth
            }
          }
        ]
      },
      { blocksBehind: 0, expireSeconds: 60 }
    )
  }

  public async loadSystemContracts() {
    await this.setContract(
      'eosio',
      path.join(__dirname, '../systemContracts/eosio.bios.wasm')
    )
    await this.createAccount('eosio.token')
    await this.setContract(
      'eosio.token',
      path.join(__dirname, '../systemContracts/eosio.token.wasm')
    )
    await this.eos.transact(
      {
        actions: [
          {
            account: 'eosio.token',
            name: 'create',
            authorization: [
              {
                actor: 'eosio.token',
                permission: 'active'
              }
            ],
            data: {
              issuer: 'eosio.token',
              maximum_supply: '1000000000.0000 EOS'
            }
          }
        ]
      },
      { blocksBehind: 0, expireSeconds: 60 }
    )
  }
}