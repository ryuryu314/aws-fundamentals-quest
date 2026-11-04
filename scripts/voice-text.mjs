import { questions as base } from '../src/data/questions.ts'
import { extraQuestions } from '../src/data/extraQuestions.ts'
import { createHash } from 'node:crypto'
export const questions = [...base, ...extraQuestions]
const terms = {
  'Well-Architected Framework':'ウェルアーキテクテッドフレームワーク','Key Management Service':'キーマネジメントサービス','IAM Identity Center':'アイアムアイデンティティセンター','Elastic Load Balancing':'エラスティックロードバランシング','S3 Transfer Acceleration':'エススリー、トランスファーアクセラレーション','Glacier Deep Archive':'グレイシアディープアーカイブ','Site-to-Site VPN':'サイトツーサイト、ブイピーエヌ','Certificate Manager':'サーティフィケートマネージャー','Pricing Calculator':'プライシングカリキュレーター','Cost Explorer':'コストエクスプローラー','Secrets Manager':'シークレットマネージャー','Security Hub':'セキュリティハブ','Transit Gateway':'トランジットゲートウェイ','Direct Connect':'ダイレクトコネクト','Auto Scaling':'オートスケーリング','Savings Plans':'セービングスプランズ','Route 53':'ルートフィフティスリー','Snowball Edge':'スノーボールエッジ','Snow Family':'スノーファミリー','for PostgreSQL':'フォー、ポストグレスキューエル',
  'CloudFormation':'クラウドフォーメーション','CloudWatch':'クラウドウォッチ','CloudTrail':'クラウドトレイル','CloudFront':'クラウドフロント','DynamoDB':'ダイナモディービー','Organizations':'オーガナイゼーションズ','ElastiCache':'エラスティキャッシュ','GuardDuty':'ガードデューティー','Inspector':'インスペクター','DataSync':'データシンク','Redshift':'レッドシフト','Snowball':'スノーボール','Snowcone':'スノーコーン','Artifact':'アーティファクト','Budgets':'バジェット','Fargate':'ファーゲート','Lambda':'ラムダ','Shield':'シールド','Athena':'アテナ','Macie':'メイシー','Polly':'ポリー','Glacier':'グレイシア','Standard':'スタンダード','Config':'コンフィグ','Amazon':'アマゾン','Linux':'リナックス','Allow':'アロー','Deny':'デナイ',
  'AWS':'エーダブリューエス','EC2':'イーシーツー','S3':'エススリー','IAM':'アイアム','MFA':'エムエフエー','KMS':'ケーエムエス','SCP':'エスシーピー','DDoS':'ディードス','DNS':'ディーエヌエス','CDN':'シーディーエヌ','EBS':'イービーエス','EFS':'イーエフエス','ECS':'イーシーエス','EKS':'イーケーエス','RDS':'アールディーエス','VPC':'ブイピーシー','VPN':'ブイピーエヌ','SQS':'エスキューエス','SNS':'エスエヌエス','WAF':'ワフ','NoSQL':'ノーエスキューエル','SQL':'エスキューエル','HTTPS':'エイチティーティーピーエス','HTTP':'エイチティーティーピー','TLS':'ティーエルエス','API':'エーピーアイ','ACL':'エーシーエル','CPU':'シーピーユー','OS':'オーエス','AZ':'エーゼット','IP':'アイピー','ID':'アイディー'
}
export function spokenText(text) {
  for (const [term, reading] of Object.entries(terms).sort((a,b)=>b[0].length-a[0].length)) text = text.replaceAll(term, reading)
  text = text.replaceAll('従量','じゅうりょう').replaceAll('疎結合','そけつごう').replaceAll('可用性','かようせい').replaceAll('脆弱性','ぜいじゃくせい').replaceAll('しきい値','しきいち').replaceAll('購読者','こうどくしゃ').replaceAll('2つ','ふたつ').replaceAll('１つ','ひとつ').replaceAll('1つ','ひとつ').replaceAll('（','、').replaceAll('）','、').replaceAll('／','、').replaceAll('・','、').replace(/\s+/g,' ').trim()
  if (/[A-Za-z]/.test(text)) throw new Error(`Unmapped English in voice text: ${text}`)
  return text
}
const labels = ['エー','ビー','シー','ディー','イー','エフ']
export function recordings() {
  return questions.flatMap(q => [
    { file:`${q.id}-question.mp3`, text:spokenText(`${q.question} ${q.correctAnswers.length === 1 ? '正しいものを1つ選んでください。' : `正しいものを${q.correctAnswers.length}つ選んでください。`} ${q.options.map((option,i)=>`選択肢${labels[i]}。${option}。`).join(' ')}`) },
    { file:`${q.id}-explanation.mp3`, text:spokenText(`正解は、${q.correctAnswers.map(i=>q.options[i]).join('、')}です。解説。${q.explanation}`) }
  ])
}
export function hash(value) { return createHash('sha256').update(value).digest('hex') }
