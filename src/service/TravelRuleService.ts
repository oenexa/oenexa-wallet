export interface Ivms101NaturalPerson {
  primaryIdentifier: string;
  secondaryIdentifier?: string;
  nameIdentifierType: 'LEGL' | 'BIRT';
}

export interface Ivms101Address {
  addressType: 'HOME' | 'BIZZ' | 'GEOG';
  streetName: string;
  buildingNumber?: string;
  postCode: string;
  townName: string;
  country: string; // ISO-3166-1 alpha-2
}

export interface Ivms101Originator {
  originatorPersons: {
    naturalPerson: {
      name: { nameIdentifier: Ivms101NaturalPerson[] };
      geographicAddress: Ivms101Address[];
      customerIdentification: string;
      dateAndPlaceOfBirth?: { dateOfBirth: string; placeOfBirth: string };
    };
  }[];
  accountNumbers: string[];
}

export interface Ivms101Beneficiary {
  beneficiaryPersons: {
    naturalPerson: {
      name: { nameIdentifier: Ivms101NaturalPerson[] };
    };
  }[];
  accountNumbers: string[];
}

export interface TravelRuleMessage {
  protocolVersion: 'IVMS-101.2020';
  transferId: string;
  originatorVASP: { vaspId: string; name: string };
  beneficiaryVASP: { vaspId: string; name: string; trisaEndpoint?: string };
  asset: string;
  amount: string;
  fiatValueUsd: number;
  isTravelRuleApplicable: boolean; // FATF Threshold >= 1000 USD
  originator: Ivms101Originator;
  beneficiary: Ivms101Beneficiary;
  signature: string;
  timestamp: string;
}

export class TravelRuleService {
  private readonly FATF_THRESHOLD_USD = 1000;
  private readonly ORIGINATOR_VASP_ID = 'VASP-OENEXA-CH-001';
  private readonly ORIGINATOR_VASP_NAME = 'OENEXA Institutional Custody AG';

  public evaluateAndBuildMessage(params: {
    transferId: string;
    asset: string;
    amount: string;
    fiatValueUsd: number;
    originatorUserId: string;
    originatorName: string;
    originatorCountry: string;
    originatorTown: string;
    originatorAddress: string;
    originatorPostalCode: string;
    originatorDob?: string;
    beneficiaryName: string;
    beneficiaryVaspId: string;
    beneficiaryVaspName: string;
    beneficiaryAddress: string;
    sourceWalletAddress: string;
  }): TravelRuleMessage {
    const isApplicable = params.fiatValueUsd >= this.FATF_THRESHOLD_USD;

    const message: TravelRuleMessage = {
      protocolVersion: 'IVMS-101.2020',
      transferId: params.transferId,
      originatorVASP: {
        vaspId: this.ORIGINATOR_VASP_ID,
        name: this.ORIGINATOR_VASP_NAME,
      },
      beneficiaryVASP: {
        vaspId: params.beneficiaryVaspId,
        name: params.beneficiaryVaspName,
      },
      asset: params.asset,
      amount: params.amount,
      fiatValueUsd: params.fiatValueUsd,
      isTravelRuleApplicable: isApplicable,
      originator: {
        originatorPersons: [
          {
            naturalPerson: {
              name: {
                nameIdentifier: [
                  {
                    primaryIdentifier: params.originatorName,
                    nameIdentifierType: 'LEGL',
                  },
                ],
              },
              geographicAddress: [
                {
                  addressType: 'HOME',
                  streetName: params.originatorAddress,
                  postCode: params.originatorPostalCode,
                  townName: params.originatorTown,
                  country: params.originatorCountry,
                },
              ],
              customerIdentification: params.originatorUserId,
              dateAndPlaceOfBirth: params.originatorDob
                ? { dateOfBirth: params.originatorDob, placeOfBirth: params.originatorCountry }
                : undefined,
            },
          },
        ],
        accountNumbers: [params.sourceWalletAddress],
      },
      beneficiary: {
        beneficiaryPersons: [
          {
            naturalPerson: {
              name: {
                nameIdentifier: [
                  {
                    primaryIdentifier: params.beneficiaryName,
                    nameIdentifierType: 'LEGL',
                  },
                ],
              },
            },
          },
        ],
        accountNumbers: [params.beneficiaryAddress],
      },
      signature: `SIG_TRISA_ED25519_${params.transferId}_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    return message;
  }
}
