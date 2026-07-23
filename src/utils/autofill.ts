import { countryRegions, getCountryRegion } from '../data/countries'

export type AutofillProfile = {
  countryCode: string
  country: string
  countryEnglish: string
  givenName: string
  familyName: string
  fullName: string
  username: string
  email: string
  phone: string
  company: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
}

export type TestCard = {
  id: string
  provider: 'Stripe' | 'Adyen' | 'PayPal' | 'Airwallex'
  scenarioId: string
  scenarioLabel: string
  scenarioDescription: string
  scenarioTone: 'success' | 'warning' | 'danger' | 'info'
  brand: 'Visa' | 'Mastercard' | 'American Express' | 'JCB' | 'Discover' | 'Diners Club' | 'Maestro' | 'UnionPay'
  number: string
  expiry: string
  expiryMonth: string
  expiryYear: string
  cvc: string
  holderName?: string
  trigger?: string
  sourceUrl: string
}

type CountryTemplate = {
  code: string
  label: string
  englishLabel: string
  dialCode: string
  givenNames: string[]
  familyNames: string[]
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  company: string
  phone: () => string
}

function randomInt(max: number) {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] % max
}

function pick<T>(values: T[]) {
  return values[randomInt(values.length)]
}

function digits(length: number) {
  return String(randomInt(10 ** length)).padStart(length, '0')
}

const countryTemplates: CountryTemplate[] = [
  {
    code: 'CN',
    label: '中国',
    englishLabel: 'China',
    dialCode: '+86',
    givenNames: ['Wei', 'Ming', 'Jia', 'Yu', 'Xiao'],
    familyNames: ['Zhang', 'Wang', 'Li', 'Chen', 'Liu'],
    addressLine1: '建国路 88 号',
    addressLine2: '示例中心 1208',
    city: '北京',
    state: '北京',
    postalCode: '100022',
    company: '示例科技有限公司',
    phone: () => `+86 138 ${digits(4)} ${digits(4)}`,
  },
  {
    code: 'US',
    label: '美国',
    englishLabel: 'United States',
    dialCode: '+1',
    givenNames: ['Alex', 'Taylor', 'Jordan', 'Morgan', 'Casey'],
    familyNames: ['Parker', 'Morgan', 'Hayes', 'Reed', 'Cooper'],
    addressLine1: '1200 Example Avenue',
    addressLine2: 'Suite 200',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    company: 'Example Labs',
    phone: () => `+1 202-555-01${digits(2)}`,
  },
  {
    code: 'GB',
    label: '英国',
    englishLabel: 'United Kingdom',
    dialCode: '+44',
    givenNames: ['Oliver', 'Amelia', 'Harry', 'Isla', 'George'],
    familyNames: ['Smith', 'Taylor', 'Brown', 'Wilson', 'Davies'],
    addressLine1: '18 Example Road',
    addressLine2: 'Flat 4',
    city: 'London',
    state: 'Greater London',
    postalCode: 'SW1A 1AA',
    company: 'Example Works Ltd',
    phone: () => `+44 7700 900${digits(3)}`,
  },
  {
    code: 'FR',
    label: '法国',
    englishLabel: 'France',
    dialCode: '+33',
    givenNames: ['Camille', 'Louis', 'Emma', 'Hugo', 'Chloé'],
    familyNames: ['Martin', 'Bernard', 'Robert', 'Petit', 'Durand'],
    addressLine1: '12 rue Exemple',
    addressLine2: 'Appartement 3',
    city: 'Paris',
    state: 'Île-de-France',
    postalCode: '75008',
    company: 'Atelier Exemple',
    phone: () => `+33 6 00 00 ${digits(2)} ${digits(2)}`,
  },
  {
    code: 'DE',
    label: '德国',
    englishLabel: 'Germany',
    dialCode: '+49',
    givenNames: ['Lena', 'Leon', 'Mia', 'Paul', 'Emilia'],
    familyNames: ['Müller', 'Schmidt', 'Weber', 'Wagner', 'Becker'],
    addressLine1: '24 Beispielstraße',
    addressLine2: 'Etage 2',
    city: 'Berlin',
    state: 'Berlin',
    postalCode: '10115',
    company: 'Beispiel Studio GmbH',
    phone: () => `+49 151 0000 ${digits(4)}`,
  },
  {
    code: 'JP',
    label: '日本',
    englishLabel: 'Japan',
    dialCode: '+81',
    givenNames: ['Haruto', 'Yui', 'Ren', 'Aoi', 'Sota'],
    familyNames: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe'],
    addressLine1: '1-2-3 Sample',
    addressLine2: 'Demo Building 301',
    city: 'Shibuya-ku',
    state: 'Tokyo',
    postalCode: '150-0001',
    company: 'Sample Works KK',
    phone: () => `+81 90-0000-${digits(4)}`,
  },
  {
    code: 'SG',
    label: '新加坡',
    englishLabel: 'Singapore',
    dialCode: '+65',
    givenNames: ['Ethan', 'Emma', 'Lucas', 'Chloe', 'Ryan'],
    familyNames: ['Tan', 'Lim', 'Lee', 'Ng', 'Wong'],
    addressLine1: '10 Example Walk',
    addressLine2: '#08-01',
    city: 'Singapore',
    state: 'Singapore',
    postalCode: '018956',
    company: 'Example Pacific Pte Ltd',
    phone: () => `+65 8000 ${digits(4)}`,
  },
  {
    code: 'AU',
    label: '澳大利亚',
    englishLabel: 'Australia',
    dialCode: '+61',
    givenNames: ['Jack', 'Charlotte', 'Noah', 'Matilda', 'William'],
    familyNames: ['Williams', 'Jones', 'Wilson', 'Anderson', 'Thomas'],
    addressLine1: '42 Example Street',
    addressLine2: 'Unit 7',
    city: 'Sydney',
    state: 'NSW',
    postalCode: '2000',
    company: 'Example Harbour Pty Ltd',
    phone: () => `+61 491 570 ${digits(3)}`,
  },
  {
    code: 'CA',
    label: '加拿大',
    englishLabel: 'Canada',
    dialCode: '+1',
    givenNames: ['Liam', 'Olivia', 'Noah', 'Emma', 'Lucas'],
    familyNames: ['Martin', 'Roy', 'Wilson', 'Brown', 'Taylor'],
    addressLine1: '88 Example Crescent',
    addressLine2: 'Unit 12',
    city: 'Toronto',
    state: 'ON',
    postalCode: 'M5V 2T6',
    company: 'Example North Inc',
    phone: () => `+1 416-555-01${digits(2)}`,
  },
  {
    code: 'ES',
    label: '西班牙',
    englishLabel: 'Spain',
    dialCode: '+34',
    givenNames: ['Lucía', 'Hugo', 'Sofía', 'Martín', 'Daniel'],
    familyNames: ['García', 'Martínez', 'López', 'Sánchez', 'Pérez'],
    addressLine1: 'Calle Ejemplo 20',
    addressLine2: 'Piso 3',
    city: 'Madrid',
    state: 'Madrid',
    postalCode: '28001',
    company: 'Estudio Ejemplo SL',
    phone: () => `+34 600 000 ${digits(3)}`,
  },
  {
    code: 'IT',
    label: '意大利',
    englishLabel: 'Italy',
    dialCode: '+39',
    givenNames: ['Sofia', 'Leonardo', 'Giulia', 'Lorenzo', 'Aurora'],
    familyNames: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi'],
    addressLine1: 'Via Esempio 16',
    addressLine2: 'Interno 4',
    city: 'Milano',
    state: 'MI',
    postalCode: '20121',
    company: 'Studio Esempio SRL',
    phone: () => `+39 320 000 ${digits(4)}`,
  },
  {
    code: 'NL',
    label: '荷兰',
    englishLabel: 'Netherlands',
    dialCode: '+31',
    givenNames: ['Emma', 'Noah', 'Julia', 'Liam', 'Tess'],
    familyNames: ['De Jong', 'Jansen', 'De Vries', 'Bakker', 'Visser'],
    addressLine1: 'Voorbeeldstraat 14',
    addressLine2: '2A',
    city: 'Amsterdam',
    state: 'Noord-Holland',
    postalCode: '1012 AB',
    company: 'Voorbeeld Studio BV',
    phone: () => `+31 6 0000 ${digits(4)}`,
  },
  {
    code: 'BR',
    label: '巴西',
    englishLabel: 'Brazil',
    dialCode: '+55',
    givenNames: ['Miguel', 'Helena', 'Arthur', 'Alice', 'Theo'],
    familyNames: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Costa'],
    addressLine1: 'Rua Exemplo 120',
    addressLine2: 'Apto 52',
    city: 'São Paulo',
    state: 'SP',
    postalCode: '01310-100',
    company: 'Exemplo Digital Ltda',
    phone: () => `+55 11 90000-${digits(4)}`,
  },
  {
    code: 'IN',
    label: '印度',
    englishLabel: 'India',
    dialCode: '+91',
    givenNames: ['Aarav', 'Aadhya', 'Vihaan', 'Anaya', 'Arjun'],
    familyNames: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta'],
    addressLine1: '42 Example Enclave',
    addressLine2: 'Floor 3',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    company: 'Example Systems Pvt Ltd',
    phone: () => `+91 90000 ${digits(5)}`,
  },
  {
    code: 'KR',
    label: '韩国',
    englishLabel: 'South Korea',
    dialCode: '+82',
    givenNames: ['Seo-jun', 'Ji-woo', 'Min-jun', 'Seo-yeon', 'Do-yun'],
    familyNames: ['Kim', 'Lee', 'Park', 'Choi', 'Jung'],
    addressLine1: '12 Sample-ro',
    addressLine2: 'Unit 801',
    city: 'Seoul',
    state: 'Seoul',
    postalCode: '04524',
    company: 'Sample Seoul Co Ltd',
    phone: () => `+82 10-0000-${digits(4)}`,
  },
]

export const autofillCountries = countryRegions.map(country => ({
  label: country.label,
  value: country.code,
  description: `${country.englishLabel} · ${country.code} · ${country.dialCode}`,
}))

function safeEmailName(givenName: string, familyName: string) {
  return `${givenName}.${familyName}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]/gi, '').toLowerCase() || `test.user${digits(3)}`
}

export function generateTestEmail(_profile: Pick<AutofillProfile, 'givenName' | 'familyName'>, domain = 'gmail.com') {
  return `test${digits(7)}@${domain}`
}

export function generateTestUsername(profile: Pick<AutofillProfile, 'givenName' | 'familyName'>) {
  return `${safeEmailName(profile.givenName, profile.familyName).replace(/\./g, '_')}_${digits(3)}`
}

export function generateTestPhone(countryCode = 'US') {
  const template = countryTemplates.find(country => country.code === countryCode)
  if (template) return template.phone()
  return `${getCountryRegion(countryCode).dialCode} ${digits(3)} ${digits(3)} ${digits(4)}`
}

export function generateTestProfile(countryCode = 'US', emailDomain = 'gmail.com'): AutofillProfile {
  const region = getCountryRegion(countryCode)
  const template = countryTemplates.find(country => country.code === countryCode)
  const fallbackTemplate = countryTemplates.find(country => country.code === 'US')!
  const givenName = pick(template?.givenNames || fallbackTemplate.givenNames)
  const familyName = pick(template?.familyNames || fallbackTemplate.familyNames)
  const names = { givenName, familyName }
  return {
    countryCode: region.code,
    country: region.label,
    countryEnglish: region.englishLabel,
    givenName,
    familyName,
    fullName: `${givenName} ${familyName}`,
    username: generateTestUsername(names),
    email: generateTestEmail(names, emailDomain),
    phone: generateTestPhone(region.code),
    company: template?.company || `Test Labs ${region.code}`,
    addressLine1: template?.addressLine1 || `${100 + randomInt(900)} Test Street`,
    addressLine2: template?.addressLine2 || 'Suite 100',
    city: template?.city || `${region.englishLabel} Test City`,
    state: template?.state || region.code,
    postalCode: template?.postalCode || digits(5),
  }
}

type TestCardInput = Omit<TestCard, 'expiry' | 'expiryMonth' | 'expiryYear' | 'cvc'> & Partial<Pick<TestCard, 'expiry' | 'expiryMonth' | 'expiryYear' | 'cvc'>>

function createTestCard(input: TestCardInput): TestCard {
  return {
    expiry: '12/34',
    expiryMonth: '12',
    expiryYear: '2034',
    cvc: input.brand === 'American Express' ? '1234' : '123',
    ...input,
  }
}

const stripeSource = 'https://docs.stripe.com/testing'
const adyenCardSource = 'https://docs.adyen.com/development-resources/test-cards-and-credentials/test-card-numbers/'
const adyenStatusSource = 'https://docs.adyen.com/development-resources/testing/result-codes'
const paypalSource = 'https://developer.paypal.com/tools/sandbox/card-testing/'
const airwallexSource = 'https://www.airwallex.com/docs/payments/test-and-go-live/test-card-numbers'

export const testCards: TestCard[] = [
  createTestCard({ id: 'stripe-success-visa', provider: 'Stripe', scenarioId: 'stripe-success', scenarioLabel: '支付成功', scenarioDescription: '模拟正常授权与支付成功', scenarioTone: 'success', brand: 'Visa', number: '4242424242424242', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-success-mastercard', provider: 'Stripe', scenarioId: 'stripe-success', scenarioLabel: '支付成功', scenarioDescription: '模拟正常授权与支付成功', scenarioTone: 'success', brand: 'Mastercard', number: '5555555555554444', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-success-amex', provider: 'Stripe', scenarioId: 'stripe-success', scenarioLabel: '支付成功', scenarioDescription: '模拟正常授权与支付成功', scenarioTone: 'success', brand: 'American Express', number: '378282246310005', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-declined', provider: 'Stripe', scenarioId: 'stripe-declined', scenarioLabel: '通用拒付', scenarioDescription: '返回 card_declined / generic_decline', scenarioTone: 'danger', brand: 'Visa', number: '4000000000000002', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-insufficient', provider: 'Stripe', scenarioId: 'stripe-insufficient', scenarioLabel: '余额不足', scenarioDescription: '返回 insufficient_funds', scenarioTone: 'warning', brand: 'Visa', number: '4000000000009995', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-expired', provider: 'Stripe', scenarioId: 'stripe-expired', scenarioLabel: '卡片过期', scenarioDescription: '返回 expired_card', scenarioTone: 'danger', brand: 'Visa', number: '4000000000000069', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-cvc', provider: 'Stripe', scenarioId: 'stripe-cvc', scenarioLabel: 'CVC 错误', scenarioDescription: '返回 incorrect_cvc', scenarioTone: 'warning', brand: 'Visa', number: '4000000000000127', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-processing', provider: 'Stripe', scenarioId: 'stripe-processing', scenarioLabel: '处理错误', scenarioDescription: '返回 processing_error', scenarioTone: 'info', brand: 'Visa', number: '4000000000000119', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-lost', provider: 'Stripe', scenarioId: 'stripe-lost', scenarioLabel: '挂失卡', scenarioDescription: '返回 lost_card', scenarioTone: 'danger', brand: 'Visa', number: '4000000000009987', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-stolen', provider: 'Stripe', scenarioId: 'stripe-stolen', scenarioLabel: '被盗卡', scenarioDescription: '返回 stolen_card', scenarioTone: 'danger', brand: 'Visa', number: '4000000000009979', sourceUrl: stripeSource }),
  createTestCard({ id: 'stripe-3ds', provider: 'Stripe', scenarioId: 'stripe-3ds', scenarioLabel: '需要 3DS', scenarioDescription: '在会话内支付中始终要求身份验证', scenarioTone: 'info', brand: 'Visa', number: '4000002500003155', trigger: '需要完成 3D Secure 验证', sourceUrl: stripeSource }),

  createTestCard({ id: 'adyen-success-visa', provider: 'Adyen', scenarioId: 'adyen-success', scenarioLabel: '支付成功', scenarioDescription: '持卡人姓名触发 Authorised', scenarioTone: 'success', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'APPROVED', trigger: '持卡人姓名：APPROVED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-success-mastercard', provider: 'Adyen', scenarioId: 'adyen-success', scenarioLabel: '支付成功', scenarioDescription: '持卡人姓名触发 Authorised', scenarioTone: 'success', brand: 'Mastercard', number: '5454545454545454', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'APPROVED', trigger: '持卡人姓名：APPROVED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-success-amex', provider: 'Adyen', scenarioId: 'adyen-success', scenarioLabel: '支付成功', scenarioDescription: '持卡人姓名触发 Authorised', scenarioTone: 'success', brand: 'American Express', number: '371449635398431', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '7373', holderName: 'APPROVED', trigger: '持卡人姓名：APPROVED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-declined', provider: 'Adyen', scenarioId: 'adyen-declined', scenarioLabel: '通用拒付', scenarioDescription: '返回 Refused', scenarioTone: 'danger', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'DECLINED', trigger: '持卡人姓名：DECLINED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-insufficient', provider: 'Adyen', scenarioId: 'adyen-insufficient', scenarioLabel: '余额不足', scenarioDescription: '返回 Not enough balance', scenarioTone: 'warning', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'NOT_ENOUGH_BALANCE', trigger: '持卡人姓名：NOT_ENOUGH_BALANCE', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-expired', provider: 'Adyen', scenarioId: 'adyen-expired', scenarioLabel: '卡片过期', scenarioDescription: '返回 Expired Card', scenarioTone: 'danger', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'CARD_EXPIRED', trigger: '持卡人姓名：CARD_EXPIRED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-cvc', provider: 'Adyen', scenarioId: 'adyen-cvc', scenarioLabel: 'CVC 拒绝', scenarioDescription: '返回 CVC Declined', scenarioTone: 'warning', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', holderName: 'CVC_DECLINED', trigger: '持卡人姓名：CVC_DECLINED', sourceUrl: adyenStatusSource }),
  createTestCard({ id: 'adyen-3ds', provider: 'Adyen', scenarioId: 'adyen-3ds', scenarioLabel: '3DS2 验证', scenarioDescription: '使用 Adyen 3DS2 注册测试卡', scenarioTone: 'info', brand: 'Visa', number: '4917610000000000', expiry: '03/30', expiryMonth: '03', expiryYear: '2030', cvc: '737', trigger: '结果由 3DS2 测试认证流程决定', sourceUrl: adyenCardSource }),

  createTestCard({ id: 'paypal-success-visa', provider: 'PayPal', scenarioId: 'paypal-success', scenarioLabel: '支付成功', scenarioDescription: 'Expanded Checkout 沙箱成功支付', scenarioTone: 'success', brand: 'Visa', number: '4012888888881881', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-success-amex', provider: 'PayPal', scenarioId: 'paypal-success', scenarioLabel: '支付成功', scenarioDescription: 'Expanded Checkout 沙箱成功支付', scenarioTone: 'success', brand: 'American Express', number: '371449635398431', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-declined', provider: 'PayPal', scenarioId: 'paypal-declined', scenarioLabel: '卡片拒付', scenarioDescription: '返回 DO_NOT_HONOR', scenarioTone: 'danger', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-REFUSED', trigger: '持卡人姓名：CCREJECT-REFUSED', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-insufficient', provider: 'PayPal', scenarioId: 'paypal-insufficient', scenarioLabel: '余额不足', scenarioDescription: '返回 INSUFFICIENT_FUNDS', scenarioTone: 'warning', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-IF', trigger: '持卡人姓名：CCREJECT-IF', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-expired', provider: 'PayPal', scenarioId: 'paypal-expired', scenarioLabel: '卡片过期', scenarioDescription: '返回 EXPIRED_CARD', scenarioTone: 'danger', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-EC', trigger: '持卡人姓名：CCREJECT-EC', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-fraud', provider: 'PayPal', scenarioId: 'paypal-fraud', scenarioLabel: '疑似欺诈', scenarioDescription: '返回 SUSPECTED_FRAUD', scenarioTone: 'danger', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-SF', trigger: '持卡人姓名：CCREJECT-SF', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-lost', provider: 'PayPal', scenarioId: 'paypal-lost', scenarioLabel: '挂失或被盗', scenarioDescription: '返回 LOST_OR_STOLEN', scenarioTone: 'danger', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-LS', trigger: '持卡人姓名：CCREJECT-LS', sourceUrl: paypalSource }),
  createTestCard({ id: 'paypal-cvc', provider: 'PayPal', scenarioId: 'paypal-cvc', scenarioLabel: 'CVC 错误', scenarioDescription: '返回 CVV2_FAILURE', scenarioTone: 'warning', brand: 'Visa', number: '4012888888881881', holderName: 'CCREJECT-CVV_F', trigger: '持卡人姓名：CCREJECT-CVV_F', sourceUrl: paypalSource }),

  createTestCard({ id: 'airwallex-success-visa', provider: 'Airwallex', scenarioId: 'airwallex-success', scenarioLabel: '支付成功', scenarioDescription: '任意金额均可成功', scenarioTone: 'success', brand: 'Visa', number: '4035501000000008', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-success-amex', provider: 'Airwallex', scenarioId: 'airwallex-success', scenarioLabel: '支付成功', scenarioDescription: '任意金额均可成功', scenarioTone: 'success', brand: 'American Express', number: '370636803809394', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-success-jcb', provider: 'Airwallex', scenarioId: 'airwallex-success', scenarioLabel: '支付成功', scenarioDescription: '任意金额均可成功', scenarioTone: 'success', brand: 'JCB', number: '3569599999097585', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-success-discover', provider: 'Airwallex', scenarioId: 'airwallex-success', scenarioLabel: '支付成功', scenarioDescription: '任意金额均可成功', scenarioTone: 'success', brand: 'Discover', number: '6580070000000008', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-success-unionpay', provider: 'Airwallex', scenarioId: 'airwallex-success', scenarioLabel: '支付成功', scenarioDescription: '任意金额均可成功', scenarioTone: 'success', brand: 'UnionPay', number: '6250941006528599', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-insufficient', provider: 'Airwallex', scenarioId: 'airwallex-insufficient', scenarioLabel: '余额不足', scenarioDescription: '金额 80.51 时返回 issuer_declined', scenarioTone: 'warning', brand: 'Mastercard', number: '5307837360544518', trigger: '支付金额：80.51', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-fraud', provider: 'Airwallex', scenarioId: 'airwallex-fraud', scenarioLabel: '疑似欺诈', scenarioDescription: '金额 80.59 时触发 issuer_declined', scenarioTone: 'danger', brand: 'Visa', number: '4012000300001003', trigger: '支付金额：80.59', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-3ds-success', provider: 'Airwallex', scenarioId: 'airwallex-3ds-success', scenarioLabel: '3DS 挑战成功', scenarioDescription: '模拟挑战模式并成功认证', scenarioTone: 'info', brand: 'Visa', number: '4012000300000062', trigger: '3DS 验证码：1234', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-3ds-failed', provider: 'Airwallex', scenarioId: 'airwallex-3ds-failed', scenarioLabel: '3DS 认证失败', scenarioDescription: '返回 authentication_failed', scenarioTone: 'danger', brand: 'Visa', number: '4012000300000070', sourceUrl: airwallexSource }),
  createTestCard({ id: 'airwallex-invalid', provider: 'Airwallex', scenarioId: 'airwallex-invalid', scenarioLabel: '无效卡号', scenarioDescription: '返回 validation_error / invalid_pan', scenarioTone: 'danger', brand: 'Visa', number: '1111111111111111', sourceUrl: airwallexSource }),
]

export type AutofillPayload = {
  identity?: AutofillProfile
  payment?: {
    name: string
    number: string
    expiry: string
    expiryMonth: string
    expiryYear: string
    cvc: string
  }
}

export function fillPageFields(payload: AutofillPayload) {
  const identity = payload.identity
  const payment = payload.payment
  const normalize = (value: string) => value.toLowerCase().replace(/[\s_\-:[\]()/.]+/g, ' ')
  const labelText = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '' : ''
    return `${byFor} ${element.closest('label')?.textContent || ''}`
  }
  const hintFor = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => normalize([
    element.getAttribute('autocomplete') || '',
    element.getAttribute('name') || '',
    element.id || '',
    element.getAttribute('placeholder') || '',
    element.getAttribute('aria-label') || '',
    labelText(element),
  ].join(' '))
  const autocompleteFor = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const tokens = (element.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)
    return tokens[tokens.length - 1] || ''
  }
  const detectField = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const autocomplete = autocompleteFor(element)
    const hint = hintFor(element)
    const autocompleteMap: Record<string, string> = {
      name: 'fullName',
      'given-name': 'givenName',
      'family-name': 'familyName',
      username: 'username',
      email: 'email',
      tel: 'phone',
      'street-address': 'addressLine1',
      'address-line1': 'addressLine1',
      'address-line2': 'addressLine2',
      'address-level2': 'city',
      'address-level1': 'state',
      'postal-code': 'postalCode',
      country: 'country',
      'country-name': 'country',
      organization: 'company',
      'cc-name': 'cardName',
      'cc-number': 'cardNumber',
      'cc-exp': 'cardExpiry',
      'cc-exp-month': 'cardExpiryMonth',
      'cc-exp-year': 'cardExpiryYear',
      'cc-csc': 'cardCvc',
    }
    if (autocompleteMap[autocomplete]) return autocompleteMap[autocomplete]
    if (element instanceof HTMLInputElement && element.type === 'email') return 'email'
    if (element instanceof HTMLInputElement && element.type === 'tel') return 'phone'
    if (/(card ?number|cardnumber|cc ?number|卡号)/.test(hint)) return 'cardNumber'
    if (/(cvv|cvc|security ?code|安全码)/.test(hint)) return 'cardCvc'
    if (/(expir|expiry|expiration|有效期)/.test(hint) && /(month|月份)/.test(hint)) return 'cardExpiryMonth'
    if (/(expir|expiry|expiration|有效期)/.test(hint) && /(year|年份)/.test(hint)) return 'cardExpiryYear'
    if (/(expir|expiry|expiration|有效期|mm ?yy)/.test(hint)) return 'cardExpiry'
    if (/(card ?holder|name ?on ?card|持卡人)/.test(hint)) return 'cardName'
    if (/(first ?name|given ?name|名$|名字)/.test(hint)) return 'givenName'
    if (/(last ?name|family ?name|surname|姓)/.test(hint)) return 'familyName'
    if (/(full ?name|your ?name|customer ?name|姓名)/.test(hint)) return 'fullName'
    if (/(e ?mail|邮箱|电子邮件)/.test(hint)) return 'email'
    if (/(user ?name|login ?name|account ?name|用户名|登录名)/.test(hint)) return 'username'
    if (/(phone|mobile|telephone|tel|手机号|电话)/.test(hint)) return 'phone'
    if (/(address ?line ?2|address2|apartment|suite|unit|公寓|楼层)/.test(hint)) return 'addressLine2'
    if (/(street|address ?line ?1|address1|详细地址|街道|地址)/.test(hint)) return 'addressLine1'
    if (/(postal|postcode|zip|邮编)/.test(hint)) return 'postalCode'
    if (/(city|town|城市)/.test(hint)) return 'city'
    if (/(state|province|region|州|省)/.test(hint)) return 'state'
    if (/(country|国家)/.test(hint)) return 'country'
    if (/(company|organization|organisation|business ?name|公司|企业)/.test(hint)) return 'company'
    return ''
  }
  const valueFor = (field: string) => {
    const values: Record<string, string | undefined> = {
      fullName: identity?.fullName,
      givenName: identity?.givenName,
      familyName: identity?.familyName,
      username: identity?.username,
      email: identity?.email,
      phone: identity?.phone,
      company: identity?.company,
      addressLine1: identity?.addressLine1,
      addressLine2: identity?.addressLine2,
      city: identity?.city,
      state: identity?.state,
      postalCode: identity?.postalCode,
      country: identity?.countryCode,
      cardName: payment?.name,
      cardNumber: payment?.number,
      cardExpiry: payment?.expiry,
      cardExpiryMonth: payment?.expiryMonth,
      cardExpiryYear: payment?.expiryYear,
      cardCvc: payment?.cvc,
    }
    return values[field] || ''
  }
  const setNativeValue = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, field: string) => {
    if (element instanceof HTMLSelectElement) {
      const normalizedValue = normalize(value)
      const identityCountry = normalize(identity?.country || '')
      const identityCountryEnglish = normalize(identity?.countryEnglish || '')
      const option = [...element.options].find(item => {
        const optionValue = normalize(item.value)
        const optionText = normalize(item.text)
        return optionValue === normalizedValue
          || optionText === normalizedValue
          || (!!identityCountry && optionText.includes(identityCountry))
          || (!!identityCountryEnglish && optionText.includes(identityCountryEnglish))
      })
      if (!option) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(element, option.value)
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(element, value)
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dataset.suiyeAutofilled = field
    element.animate([
      { boxShadow: '0 0 0 3px rgba(40,100,220,.28)', backgroundColor: 'rgba(40,100,220,.08)' },
      { boxShadow: '0 0 0 0 rgba(40,100,220,0)', backgroundColor: 'transparent' },
    ], { duration: 1500, easing: 'ease-out' })
    return true
  }

  const elements = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
  let filled = 0
  const fields: string[] = []
  for (const element of elements) {
    if (element.disabled || element.hasAttribute('readonly')) continue
    if (element instanceof HTMLInputElement && ['hidden', 'password', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset'].includes(element.type)) continue
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) continue
    const field = detectField(element)
    const value = valueFor(field)
    if (!field || !value) continue
    if (setNativeValue(element, value, field)) {
      filled += 1
      fields.push(field)
    }
  }
  return { filled, fields }
}
