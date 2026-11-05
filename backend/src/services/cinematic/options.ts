/**
 * 影像参数（Cinematic Spec）可选项：导演风格、摄影机、镜头、焦段、胶片、画幅、色调、布光、景别、机位、
 * 三维构图层次、构图技巧、运镜、微观表演、氛围细节、硬性技术约束。
 *
 * 每一项都写清楚「作用」（desc）：用户在界面上看得懂选的是什么效果，拼进提示词时也带着这句效果描述，
 * 视频 / 图片模型只认器材名不一定懂，写出效果才稳定。
 * id 一旦发布就不要改（项目 / 预设里存的是 id）；新增随便加。
 */

export interface CineOption {
  id: string
  /** 界面显示名（中文） */
  label: string
  /** 英文术语（拼进提示词时附在后面，视频模型对英文术语更敏感） */
  en?: string
  /** 作用 / 效果的白话说明 */
  desc: string
  /** 分组（界面里分组显示） */
  group?: string
}

export interface PaletteColor { name: string; hex: string; percent: number }
export interface PalettePreset { id: string; label: string; desc: string; colors: PaletteColor[] }

/** 风格锚定：导演美学 + 类型片基调，可多选组合（如「徐克导演美学 • 写实新国风武侠」） */
export const STYLE_ANCHORS: CineOption[] = [
  // 导演美学
  { id: 'tsui-hark', group: '导演美学', label: '徐克导演美学', en: 'Tsui Hark aesthetic', desc: '江湖奇情、凌厉动作与写意留白并存，飘逸衣袂、险峻构图、动作里带黑色幽默' },
  { id: 'wong-kar-wai', group: '导演美学', label: '王家卫导演美学', en: 'Wong Kar-wai aesthetic', desc: '暧昧霓虹、抽帧慢门、浓郁暖红墨绿，人物孤独疏离、画框里套画框' },
  { id: 'zhang-yimou', group: '导演美学', label: '张艺谋导演美学', en: 'Zhang Yimou aesthetic', desc: '大色块饱和造型、对称仪式感构图、成片群像与浓烈红黄' },
  { id: 'hou-hsiao-hsien', group: '导演美学', label: '侯孝贤导演美学', en: 'Hou Hsiao-hsien aesthetic', desc: '长镜头固定机位、自然光、人物在景深里低调生活，克制留白' },
  { id: 'ang-lee', group: '导演美学', label: '李安导演美学', en: 'Ang Lee aesthetic', desc: '含蓄内敛的情感张力、东方意境与精准表演，竹林水墨般的空灵' },
  { id: 'king-hu', group: '导演美学', label: '胡金铨导演美学', en: 'King Hu aesthetic', desc: '古典武侠、山林客栈、逆光烟尘中的剪影对决，京剧式节奏' },
  { id: 'chen-kaige', group: '导演美学', label: '陈凯歌导演美学', en: 'Chen Kaige aesthetic', desc: '宏大史诗、戏曲意象、浓烈情感与宿命感' },
  { id: 'kurosawa', group: '导演美学', label: '黑泽明导演美学', en: 'Akira Kurosawa aesthetic', desc: '风雨烟尘中的武士群像、长焦压缩、动作的力量与天气戏剧化' },
  { id: 'kore-eda', group: '导演美学', label: '是枝裕和导演美学', en: 'Hirokazu Kore-eda aesthetic', desc: '日常家庭、柔和自然光、细腻生活质感与安静情绪' },
  { id: 'nolan', group: '导演美学', label: '诺兰导演美学', en: 'Christopher Nolan aesthetic', desc: 'IMAX 胶片大画幅、实拍特效、冷峻理性、宏大尺度' },
  { id: 'villeneuve', group: '导演美学', label: '维伦纽瓦导演美学', en: 'Denis Villeneuve aesthetic', desc: '巨物压迫感、极简几何构图、雾霭单色、低沉史诗' },
  { id: 'fincher', group: '导演美学', label: '大卫·芬奇导演美学', en: 'David Fincher aesthetic', desc: '冷绿黄调低照度、精准稳定运镜、阴郁悬疑' },
  { id: 'wes-anderson', group: '导演美学', label: '韦斯·安德森导演美学', en: 'Wes Anderson aesthetic', desc: '绝对对称、粉彩配色、平移镜头、玩偶屋式精致布景' },
  { id: 'tarantino', group: '导演美学', label: '昆汀导演美学', en: 'Quentin Tarantino aesthetic', desc: '复古胶片、低角度后备箱视角、话痨式张力与暴力美学' },
  { id: 'ridley-scott', group: '导演美学', label: '雷德利·斯科特导演美学', en: 'Ridley Scott aesthetic', desc: '烟雾体积光、史诗战场、厚重质感与历史感' },
  { id: 'deakins', group: '导演美学', label: '罗杰·迪金斯摄影风格', en: 'Roger Deakins cinematography', desc: '极简动机光源、剪影与大块阴影、干净克制的构图' },
  { id: 'chris-doyle', group: '导演美学', label: '杜可风摄影风格', en: 'Christopher Doyle cinematography', desc: '手持游走、高反差霓虹、颗粒与抽帧、自由即兴' },
  { id: 'park-chan-wook', group: '导演美学', label: '朴赞郁导演美学', en: 'Park Chan-wook aesthetic', desc: '精致对称的暴力美学、浓郁色彩、复仇与欲望的张力' },
  { id: 'bong-joon-ho', group: '导演美学', label: '奉俊昊导演美学', en: 'Bong Joon-ho aesthetic', desc: '阶层空间隐喻、类型混搭、黑色幽默中的悬疑' },
  { id: 'jia-zhangke', group: '导演美学', label: '贾樟柯导演美学', en: 'Jia Zhangke aesthetic', desc: '纪实感长镜头、县城变迁、灰调现实主义' },
  // 类型片基调
  { id: 'neo-wuxia', group: '类型基调', label: '写实新国风武侠', en: 'realistic neo-Chinese wuxia', desc: '清冷苍茫的水墨意境 + 江湖市井烟火气，真实材质、真实动作' },
  { id: 'xianxia', group: '类型基调', label: '仙侠玄幻', en: 'xianxia fantasy', desc: '云海仙山、飘逸法衣、灵光粒子与宏大法术' },
  { id: 'palace', group: '类型基调', label: '古装宫廷', en: 'imperial palace drama', desc: '朱墙金瓦、华服礼制、权谋暗涌的仪式感构图' },
  { id: 'republic-spy', group: '类型基调', label: '民国谍战', en: '1930s Republic-era spy noir', desc: '旧上海洋楼、雨夜霓虹、风衣礼帽、黑色电影光影' },
  { id: 'urban-romance', group: '类型基调', label: '都市情感', en: 'modern urban romance', desc: '城市夜景、通透玻璃写字楼、柔光暖调的情绪特写' },
  { id: 'ceo-sweet', group: '类型基调', label: '霸总甜宠', en: 'glossy CEO romance', desc: '高级感豪宅与办公室、干净高调光、精致妆造' },
  { id: 'revenge', group: '类型基调', label: '逆袭爽剧', en: 'underdog revenge drama', desc: '高反差情绪、打脸反转的冲击特写、节奏凌厉' },
  { id: 'suspense', group: '类型基调', label: '悬疑惊悚', en: 'suspense thriller', desc: '低照度、冷色、阴影藏人、缓慢推进制造不安' },
  { id: 'film-noir', group: '类型基调', label: '黑色电影', en: 'film noir', desc: '硬光百叶窗投影、烟雾、高反差黑白或低饱和' },
  { id: 'cyberpunk', group: '类型基调', label: '赛博朋克', en: 'cyberpunk', desc: '霓虹雨夜、全息广告、高科技低生活的拥挤街区' },
  { id: 'wasteland', group: '类型基调', label: '末日废土', en: 'post-apocalyptic wasteland', desc: '沙尘黄褐、锈蚀金属、荒凉逆光与求生质感' },
  { id: 'campus', group: '类型基调', label: '校园青春', en: 'youth campus drama', desc: '午后阳光、通透高调、清新浅色与朝气' },
  { id: 'rural', group: '类型基调', label: '乡村纪实', en: 'rural realism', desc: '田野土路、自然光、朴素真实的生活质感' },
  { id: 'horror', group: '类型基调', label: '中式恐怖', en: 'Chinese folk horror', desc: '红烛纸人、老宅幽暗、冷绿与暗红的诡异氛围' },
  { id: 'sci-fi', group: '类型基调', label: '硬科幻', en: 'hard sci-fi', desc: '冷白工业空间、精确几何、宇宙尺度的孤独' },
  { id: 'comedy', group: '类型基调', label: '喜剧反差', en: 'comedic contrast', desc: '严肃画面里的荒诞反应、夸张表情与节奏停顿' },
  { id: 'documentary', group: '类型基调', label: '纪实手持', en: 'documentary realism', desc: '手持跟拍、自然光、不修饰的真实感' },
]

/** 摄影机机身：决定宽容度、肤色、颗粒与整体质感 */
export const CAMERAS: CineOption[] = [
  { id: 'alexa-65', group: '数字电影机', label: 'ARRI Alexa 65', en: 'shot on ARRI Alexa 65', desc: '65mm 大画幅传感器，空间纵深大、背景虚化自然，史诗感强，肤色柔润' },
  { id: 'alexa-35', group: '数字电影机', label: 'ARRI Alexa 35', en: 'shot on ARRI Alexa 35', desc: '高宽容度、高光过渡柔和，肤色真实温润，暗部干净有层次' },
  { id: 'alexa-mini-lf', group: '数字电影机', label: 'ARRI Alexa Mini LF', en: 'shot on ARRI Alexa Mini LF', desc: '全画幅轻便机身，适合手持与狭小空间，画面细腻有电影感' },
  { id: 'venice-2', group: '数字电影机', label: 'Sony VENICE 2', en: 'shot on Sony VENICE 2', desc: '8.6K 全画幅，细节清楚却不生硬，服色自然，暗光下依旧干净' },
  { id: 'red-v-raptor', group: '数字电影机', label: 'RED V-RAPTOR 8K VV', en: 'shot on RED V-RAPTOR 8K VV', desc: '超高分辨率与高帧率，锐利通透，适合动作与慢动作' },
  { id: 'red-komodo', group: '数字电影机', label: 'RED Komodo 6K', en: 'shot on RED Komodo 6K', desc: '小型机身、全局快门，快速运动不变形，适合动作和车拍' },
  { id: 'panavision-dxl2', group: '数字电影机', label: 'Panavision Millennium DXL2', en: 'shot on Panavision Millennium DXL2', desc: '好莱坞大片质感，色彩浓郁厚重，配合 Panavision 镜头很有味道' },
  { id: 'ursa-12k', group: '数字电影机', label: 'Blackmagic URSA Mini Pro 12K', en: 'shot on Blackmagic URSA 12K', desc: '超高解析、色彩科学偏中性，适合后期大调色' },
  { id: 'canon-c500', group: '数字电影机', label: 'Canon EOS C500 Mark II', en: 'shot on Canon C500 Mark II', desc: '佳能肤色讨喜、偏暖柔和，适合人像和情感戏' },
  { id: 'imax-film', group: '胶片机', label: 'IMAX 15/70 胶片摄影机', en: 'shot on IMAX 70mm film camera', desc: '最大画幅胶片，极致清晰与空间感，画面像能走进去' },
  { id: 'panavision-65', group: '胶片机', label: 'Panavision System 65（70mm）', en: 'shot on 65mm film, Panavision System 65', desc: '70mm 胶片的宽阔与细腻，颗粒极细，史诗级厚重' },
  { id: 'arricam-35', group: '胶片机', label: 'ARRICAM LT（35mm 胶片）', en: 'shot on 35mm film, ARRICAM LT', desc: '经典 35mm 胶片电影质感，颗粒自然、高光柔和溢出' },
  { id: 'arri-416', group: '胶片机', label: 'ARRI 416（16mm 胶片）', en: 'shot on 16mm film, ARRI 416', desc: '16mm 粗颗粒、轻微晕染，带纪实感和怀旧味道' },
  { id: 'bolex-16', group: '胶片机', label: 'Bolex H16（复古 16mm）', en: 'vintage Bolex 16mm', desc: '老电影抖动与漏光，手工感强，适合回忆与梦境' },
  { id: 'super8', group: '胶片机', label: 'Super 8 家庭胶片', en: 'Super 8 home movie', desc: '粗颗粒、暖偏色、边缘暗角，像旧家庭录像' },
  { id: 'ronin-4d', group: '特种机位', label: 'DJI Ronin 4D', en: 'DJI Ronin 4D stabilized', desc: '内置四轴稳定，平滑跟拍长镜头，运动顺滑如滑轨' },
  { id: 'fpv-drone', group: '特种机位', label: 'FPV 穿越机', en: 'FPV drone shot', desc: '高速穿越、俯冲、贴地飞行，冲击感强的动态大场面' },
  { id: 'gopro', group: '特种机位', label: 'GoPro 运动相机', en: 'GoPro action camera POV', desc: '超广角鱼眼、第一人称沉浸感，适合极限动作' },
  { id: 'iphone', group: '特种机位', label: 'iPhone 竖屏实拍', en: 'shot on iPhone, vertical vlog', desc: '手机直拍的真实生活感，适合 vlog 与竖屏短剧' },
  { id: 'phantom', group: '特种机位', label: 'Phantom Flex 4K 高速机', en: 'Phantom Flex 4K 1000fps slow motion', desc: '上千帧超慢动作，水花、碎片、发丝清晰定格' },
]

/** 镜头组：决定焦外、眩光、边缘畸变与「味道」 */
export const LENSES: CineOption[] = [
  { id: 'zeiss-supreme', group: '球面定焦', label: 'ZEISS Supreme Prime', en: 'ZEISS Supreme Prime lens', desc: '细节清楚却不生硬，服色自然，背景柔和地虚下去' },
  { id: 'zeiss-master', group: '球面定焦', label: 'ZEISS Master Prime', en: 'ZEISS Master Prime lens', desc: '极致锐利、几乎无畸变无色散，干净现代' },
  { id: 'cooke-s4', group: '球面定焦', label: 'Cooke S4/i（Cooke Look）', en: 'Cooke S4/i lens, Cooke look', desc: '温暖柔和的「库克味」，肤色讨喜，焦外过渡奶油般顺滑' },
  { id: 'arri-signature', group: '球面定焦', label: 'ARRI Signature Prime', en: 'ARRI Signature Prime lens', desc: '大光圈全画幅，焦外柔美、人像立体，高光不刺眼' },
  { id: 'leica-summilux-c', group: '球面定焦', label: 'Leica Summilux-C', en: 'Leica Summilux-C lens', desc: '徕卡式通透与微对比，人物有空气感' },
  { id: 'laowa-argus', group: '球面定焦', label: 'LAOWA ARGUS 35mm T1 FF Cine', en: 'LAOWA ARGUS 35mm T1 FF Cine', desc: '没有横向光带，主体清楚，散景柔和偏圆，眼睛清楚，背景柔和地化开' },
  { id: 'canon-k35', group: '复古镜头', label: 'Canon K35（复古）', en: 'vintage Canon K35 lens', desc: '70 年代复古柔光，低对比、暖色光晕，怀旧氛围' },
  { id: 'helios-44', group: '复古镜头', label: 'Helios 44-2（旋焦）', en: 'Helios 44-2 swirly bokeh', desc: '漩涡状焦外，梦幻复古，适合回忆与超现实' },
  { id: 'petzval', group: '复古镜头', label: 'Petzval 佩兹伐', en: 'Petzval lens', desc: '中心锐利、边缘强烈旋转虚化，油画般的古典人像' },
  { id: 'baltar', group: '复古镜头', label: 'Bausch & Lomb Baltar', en: 'Baltar vintage lens', desc: '老好莱坞柔焦、低对比，经典黑色电影味道' },
  { id: 'laowa-proteus', group: '变形宽银幕', label: 'LAOWA PROTEUS 35mm T2 2x Blue', en: 'LAOWA PROTEUS 35mm T2 2x anamorphic, blue flare', desc: '2x 变形镜头，横向蓝色光带，椭圆光斑，科幻与动作感' },
  { id: 'panavision-c', group: '变形宽银幕', label: 'Panavision C 系列变形', en: 'Panavision C-Series anamorphic', desc: '经典好莱坞宽银幕，椭圆焦外、柔和横向眩光、边缘轻微畸变' },
  { id: 'cooke-anamorphic', group: '变形宽银幕', label: 'Cooke Anamorphic/i', en: 'Cooke Anamorphic/i lens', desc: '温润的变形镜头，暖色眩光与椭圆焦外，人像柔美' },
  { id: 'atlas-orion', group: '变形宽银幕', label: 'Atlas Orion 变形', en: 'Atlas Orion anamorphic', desc: '琥珀色横向光带、浓郁复古宽银幕感' },
  { id: 'hawk-v-lite', group: '变形宽银幕', label: 'Hawk V-Lite 变形', en: 'Hawk V-Lite anamorphic', desc: '欧洲电影常用，畸变克制、焦外椭圆细腻' },
  { id: 'angenieux-optimo', group: '变焦镜头', label: 'Angénieux Optimo 变焦', en: 'Angénieux Optimo zoom', desc: '电影级变焦，推拉变焦镜头时画质一致，适合 zoom 运镜' },
  { id: 'laowa-probe', group: '特殊镜头', label: 'LAOWA 24mm 探针微距', en: 'LAOWA 24mm probe macro', desc: '贴近物体穿行的探针视角，微观世界宏大化' },
  { id: 'macro-100', group: '特殊镜头', label: '100mm 微距', en: '100mm macro lens', desc: '睫毛、水滴、纤维等微观细节极致清晰' },
  { id: 'fisheye', group: '特殊镜头', label: '鱼眼镜头', en: 'fisheye lens', desc: '强烈桶形畸变，夸张、眩晕、主观失控感' },
  { id: 'tilt-shift', group: '特殊镜头', label: '移轴镜头', en: 'tilt-shift lens', desc: '选择性焦平面，微缩模型感或局部清晰的梦境感' },
  { id: 'split-diopter', group: '特殊镜头', label: '分屈光镜', en: 'split diopter', desc: '前景和背景同时清晰，两个人物同框对峙' },
]

/** 焦段（全画幅对角视角）：决定透视和空间压缩 */
export const FOCAL_LENGTHS: CineOption[] = [
  { id: '14mm', label: '14mm', en: '14mm lens with 114° FOV', desc: '超广角 114°，空间极度夸张，近大远小强烈，压迫或宏大' },
  { id: '18mm', label: '18mm', en: '18mm lens with 100° FOV', desc: '广角 100°，交代大环境，人物显得渺小' },
  { id: '24mm', label: '24mm', en: '24mm lens with 84° FOV', desc: '广角 84°，环境叙事与动作跟拍，有临场感' },
  { id: '28mm', label: '28mm', en: '28mm lens with 75° FOV', desc: '人文纪实视角 75°，自然又有空间感' },
  { id: '35mm', label: '35mm', en: '35mm lens with 63° FOV', desc: '标准叙事焦段 63°，接近人眼注意范围，人物与环境兼顾' },
  { id: '40mm', label: '40mm', en: '40mm lens with 57° FOV', desc: '57°，变形镜头常用的主力焦段，宽银幕叙事' },
  { id: '50mm', label: '50mm', en: '50mm lens with 47° FOV', desc: '标准镜头 47°，透视最接近人眼，平实真实' },
  { id: '65mm', label: '65mm', en: '65mm lens with 37° FOV', desc: '37°，中近景人像，背景开始柔和分离' },
  { id: '85mm', label: '85mm', en: '85mm lens with 28° FOV', desc: '人像焦段 28°，五官比例最美，背景柔和化开' },
  { id: '100mm', label: '100mm', en: '100mm lens with 24° FOV', desc: '24°，特写与微距，细节压缩、情绪集中' },
  { id: '135mm', label: '135mm', en: '135mm lens with 18° FOV', desc: '长焦 18°，强烈空间压缩、偷拍窥视感、背景如画' },
  { id: '200mm', label: '200mm', en: '200mm lens with 12° FOV', desc: '超长焦 12°，远景压缩成平面，热浪与人潮堆叠' },
  { id: '400mm', label: '400mm', en: '400mm lens with 6° FOV', desc: '6°，极端压缩，落日巨大、人物与背景贴在一起' },
]

/** 胶片 / 质感：颗粒、色彩倾向、高光溢出 */
export const FILM_STOCKS: CineOption[] = [
  { id: 'vision3-500t', group: '电影胶片', label: 'KODAK VISION3 500T 5219', en: 'Kodak Vision3 500T 5219 film stock', desc: '颗粒细、亮度柔、纹理像能摸到，夜景钨丝灯下暖中带青，这就是胶片感' },
  { id: 'vision3-250d', group: '电影胶片', label: 'KODAK VISION3 250D 5207', en: 'Kodak Vision3 250D 5207 film stock', desc: '日景胶片，色彩自然饱满，高光过渡柔和' },
  { id: 'vision3-50d', group: '电影胶片', label: 'KODAK VISION3 50D 5203', en: 'Kodak Vision3 50D 5203 film stock', desc: '最细颗粒，阳光下极致清透细腻' },
  { id: 'eterna-500', group: '电影胶片', label: 'Fujifilm ETERNA 500T', en: 'Fujifilm Eterna 500T film stock', desc: '富士电影卷，低饱和偏青绿，冷静克制的东方电影味' },
  { id: 'ektachrome', group: '电影胶片', label: 'KODAK EKTACHROME 100D', en: 'Kodak Ektachrome 100D reversal film', desc: '反转片高饱和、高对比，色彩鲜艳通透' },
  { id: 'double-x', group: '电影胶片', label: 'KODAK Double-X 5222（黑白）', en: 'Kodak Double-X 5222 black-and-white film', desc: '经典黑白电影卷，浓郁颗粒与深黑' },
  { id: 'cinestill-800t', group: '电影胶片', label: 'CineStill 800T', en: 'CineStill 800T, red halation', desc: '霓虹灯周围红色光晕（halation），夜景都市氛围感强' },
  { id: 'portra-400', group: '照片胶卷', label: 'KODAK Portra 400', en: 'Kodak Portra 400 look', desc: '人像胶卷，肤色温润、色彩柔和、低对比' },
  { id: 'fuji-400h', group: '照片胶卷', label: 'Fujifilm Pro 400H', en: 'Fujifilm Pro 400H look', desc: '清新淡雅、偏青绿高光，日系空气感' },
  { id: 'tri-x', group: '照片胶卷', label: 'KODAK Tri-X 400（黑白）', en: 'Kodak Tri-X 400 black-and-white', desc: '纪实黑白、粗颗粒、高反差，街头感' },
  { id: '35mm-grain', group: '质感', label: '35mm 真实电影胶片颗粒', en: 'cinematic 35mm film grain', desc: '35mm 电影胶片质感，颗粒自然，告别数码塑料感' },
  { id: '70mm-grain', group: '质感', label: '70mm 大画幅胶片质感', en: '70mm large-format film texture', desc: '更细的颗粒和更大的空间感，史诗级厚重' },
  { id: '16mm-grain', group: '质感', label: '16mm 粗颗粒', en: '16mm film grain', desc: '明显颗粒与轻微晕染，纪实、怀旧' },
  { id: 'live-action', group: '质感', label: '纯真人实景拍摄', en: 'photorealistic live-action footage', desc: '真人真景实拍质感，不是 CG、不是插画' },
  { id: 'digital-clean', group: '质感', label: '数字干净高清', en: 'clean digital 8K cinema image', desc: '无颗粒、通透锐利的现代数字电影画面' },
  { id: 'bleach-bypass', group: '质感', label: '漂白旁路（留银）', en: 'bleach bypass', desc: '低饱和、高反差、金属感，战争与硬派动作' },
  { id: 'cross-process', group: '质感', label: '交叉冲洗', en: 'cross-processed film', desc: '偏色强烈、对比夸张，复古 MV 与潮流感' },
]

/** 构图画幅（成片的取景比例；生成尺寸仍按项目画幅） */
export const ASPECT_RATIOS: CineOption[] = [
  { id: '16:9', label: '16:9 标准宽屏', en: '16:9 widescreen', desc: '横屏通用画幅，电视与网络视频标准' },
  { id: '16:9-anamorphic', label: '16:9 变形宽银幕', en: '16:9 anamorphic ratio', desc: '16:9 画幅内用变形镜头的横向光带与椭圆焦外，宽银幕质感' },
  { id: '2.39:1', label: '2.39:1 宽银幕（Scope）', en: '2.39:1 anamorphic scope, letterboxed', desc: '院线大片画幅，上下黑边，史诗与压迫感' },
  { id: '2.35:1', label: '2.35:1 宽银幕', en: '2.35:1 cinemascope, letterboxed', desc: '经典宽银幕比例，横向叙事、风景辽阔' },
  { id: '2:1', label: '2:1 Univisium', en: '2:1 univisium', desc: '介于宽屏与宽银幕之间，流媒体剧集常用' },
  { id: '1.85:1', label: '1.85:1 遮幅', en: '1.85:1 flat widescreen', desc: '美式遮幅，比 16:9 略宽，剧情片常用' },
  { id: '1.43:1', label: '1.43:1 IMAX', en: '1.43:1 IMAX full frame', desc: '接近方形的高画幅，垂直空间巨大、沉浸感强' },
  { id: '4:3', label: '4:3 学院比例', en: '4:3 academy ratio', desc: '复古电视与老电影，人物居中、怀旧亲密' },
  { id: '1:1', label: '1:1 方画幅', en: '1:1 square frame', desc: '对称、肖像感，适合社交平台' },
  { id: '9:16', label: '9:16 竖屏', en: '9:16 vertical frame', desc: '手机竖屏短剧，人物占满画面，近景为主' },
  { id: '3:4', label: '3:4 竖画幅', en: '3:4 portrait frame', desc: '竖向人像，信息流与海报' },
  { id: '21:9', label: '21:9 超宽', en: '21:9 ultra-wide', desc: '超宽横幅，适合大场面与横向追逐' },
]

/** 核心色调与影调预设：占比 + 色值（可在界面里改） */
export const PALETTES: PalettePreset[] = [
  { id: 'cold-river', label: '寒江青黛（新国风武侠）', desc: '清冷苍茫的江雾与船木', colors: [
    { name: '寒江青黛色', hex: '#1B333E', percent: 60 },
    { name: '迷雾灰白与船木枯褐', hex: '#8B9DA5', percent: 30 },
    { name: '粗麻暗棕与古铜微光', hex: '#4A2E1B', percent: 10 },
  ] },
  { id: 'teal-orange', label: '青橙对比（好莱坞大片）', desc: '阴影青、肤色橙，主体跳出', colors: [
    { name: '阴影深青', hex: '#12343B', percent: 55 },
    { name: '肤色暖橙', hex: '#E08A4F', percent: 30 },
    { name: '高光米白', hex: '#F2E6D8', percent: 15 },
  ] },
  { id: 'wkw-neon', label: '暧昧霓虹红绿（王家卫）', desc: '暖红与墨绿的都市孤独', colors: [
    { name: '墨绿暗部', hex: '#0F3B2E', percent: 50 },
    { name: '旗袍暗红', hex: '#8E1B24', percent: 30 },
    { name: '钨丝灯暖黄', hex: '#E3A857', percent: 20 },
  ] },
  { id: 'palace-red-gold', label: '朱红鎏金（宫廷）', desc: '朱墙金瓦的华贵与压迫', colors: [
    { name: '宫墙朱红', hex: '#8B1E1E', percent: 50 },
    { name: '鎏金', hex: '#C9A24B', percent: 30 },
    { name: '乌木深褐', hex: '#2A1A12', percent: 20 },
  ] },
  { id: 'ink-wash', label: '水墨黑白灰', desc: '留白写意的东方意境', colors: [
    { name: '浓墨', hex: '#1A1A1A', percent: 40 },
    { name: '淡墨灰', hex: '#8C8C88', percent: 35 },
    { name: '宣纸米白', hex: '#EDE7DA', percent: 25 },
  ] },
  { id: 'cyber-neon', label: '赛博霓虹', desc: '洋红与电光蓝的雨夜都市', colors: [
    { name: '夜色深蓝黑', hex: '#0B0F2A', percent: 55 },
    { name: '霓虹洋红', hex: '#FF2E88', percent: 25 },
    { name: '电光青蓝', hex: '#00E5FF', percent: 20 },
  ] },
  { id: 'noir', label: '黑色电影低饱和', desc: '硬光阴影与烟雾', colors: [
    { name: '深黑阴影', hex: '#0D0D0F', percent: 55 },
    { name: '烟灰', hex: '#5E6066', percent: 30 },
    { name: '冷白高光', hex: '#D9DDE3', percent: 15 },
  ] },
  { id: 'warm-film', label: '暖褐胶片（怀旧）', desc: '旧时光的琥珀色', colors: [
    { name: '焦糖褐', hex: '#6B4226', percent: 45 },
    { name: '琥珀暖黄', hex: '#D9A05B', percent: 35 },
    { name: '褪色奶白', hex: '#EFE3CF', percent: 20 },
  ] },
  { id: 'morandi', label: '莫兰迪低饱和（都市情感）', desc: '高级灰调的克制情绪', colors: [
    { name: '雾霾蓝灰', hex: '#7D8A96', percent: 45 },
    { name: '豆沙粉', hex: '#C4A39B', percent: 30 },
    { name: '燕麦米', hex: '#D8CFC0', percent: 25 },
  ] },
  { id: 'japanese-fresh', label: '日系清新', desc: '高调通透的夏日空气感', colors: [
    { name: '天空浅青', hex: '#A8D3DA', percent: 45 },
    { name: '奶白高光', hex: '#F7F4EC', percent: 35 },
    { name: '嫩草绿', hex: '#9CC88B', percent: 20 },
  ] },
  { id: 'wasteland', label: '废土沙尘', desc: '锈蚀与烈日的荒凉', colors: [
    { name: '沙尘土黄', hex: '#B08850', percent: 50 },
    { name: '铁锈红褐', hex: '#7A3B1D', percent: 30 },
    { name: '灰霾天空', hex: '#A7A396', percent: 20 },
  ] },
  { id: 'horror-green-red', label: '中式恐怖冷绿暗红', desc: '红烛与幽绿的诡异', colors: [
    { name: '幽冷墨绿', hex: '#14261F', percent: 55 },
    { name: '烛火暗红', hex: '#7E1414', percent: 25 },
    { name: '纸人惨白', hex: '#DCD8CC', percent: 20 },
  ] },
  { id: 'ceo-luxury', label: '黑金高级感（霸总）', desc: '大理石与金属的冷奢', colors: [
    { name: '曜石黑', hex: '#111214', percent: 50 },
    { name: '香槟金', hex: '#C8A96A', percent: 25 },
    { name: '大理石白', hex: '#E9E7E2', percent: 25 },
  ] },
  { id: 'xianxia-cloud', label: '仙气月白（仙侠）', desc: '云海与灵光', colors: [
    { name: '月白', hex: '#E6ECF2', percent: 50 },
    { name: '天青', hex: '#7FA7C4', percent: 30 },
    { name: '灵光淡金', hex: '#E8D49A', percent: 20 },
  ] },
  { id: 'republic-sepia', label: '民国旧上海', desc: '老照片般的棕褐与墨绿', colors: [
    { name: '老照片棕褐', hex: '#5A4632', percent: 45 },
    { name: '洋楼墨绿', hex: '#2F4A3A', percent: 35 },
    { name: '路灯昏黄', hex: '#D4A85A', percent: 20 },
  ] },
]

/** 主光位（布光方式） */
export const KEY_LIGHTS: CineOption[] = [
  { id: 'side-back-45', label: '45° 侧逆光', en: '45-degree side backlight', desc: '光从侧后方 45° 切入，勾出轮廓与立体，脸一半在暗处，戏剧感强' },
  { id: 'rembrandt', label: '伦勃朗光', en: 'Rembrandt lighting', desc: '暗侧脸颊出现三角形光斑，古典油画般立体沉稳' },
  { id: 'loop', label: '环形光', en: 'loop lighting', desc: '鼻影小环形落在脸颊，自然讨喜的人像光' },
  { id: 'butterfly', label: '蝴蝶光（派拉蒙光）', en: 'butterfly / Paramount lighting', desc: '正上前方打光，鼻下蝶形阴影，突出颧骨，明星感' },
  { id: 'split', label: '分割光', en: 'split lighting', desc: '脸正好一半亮一半暗，矛盾、神秘、双面人' },
  { id: 'short', label: '窄光（Short light）', en: 'short lighting', desc: '照亮远离镜头的那半边脸，显瘦、深沉' },
  { id: 'broad', label: '宽光（Broad light）', en: 'broad lighting', desc: '照亮靠近镜头的半边脸，开朗、明亮' },
  { id: 'top', label: '顶光', en: 'top light', desc: '正上方硬光，眼窝深陷，压抑、审讯、孤立' },
  { id: 'under', label: '底光', en: 'under lighting', desc: '从下往上，诡异恐怖或烛火篝火的动机光' },
  { id: 'backlight-rim', label: '逆光轮廓光', en: 'strong backlight rim light', desc: '主体被光勾出金边，剪影感与神圣感' },
  { id: 'window', label: '窗光（侧向柔光）', en: 'soft window side light', desc: '大面积柔和侧光，细腻真实的室内人像' },
  { id: 'overcast', label: '阴天漫射天光', en: 'overcast diffused skylight', desc: '没有明显阴影的柔光，冷静、写实、清冷' },
  { id: 'golden-hour', label: '黄金时刻斜阳', en: 'golden hour low sun', desc: '低角度暖光拉长影子，浪漫怀旧' },
  { id: 'blue-hour', label: '蓝调时刻', en: 'blue hour ambient', desc: '日落后冷蓝天光 + 暖色室内灯，静谧忧郁' },
  { id: 'moonlight', label: '月光', en: 'cool moonlight', desc: '冷蓝低照度，夜戏的神秘与孤独' },
  { id: 'practical', label: '画内实用光源', en: 'motivated practical lights', desc: '台灯、烛火、霓虹等画内光源照亮人物，真实可信' },
  { id: 'candle', label: '烛火 / 篝火', en: 'flickering candle / firelight', desc: '暖橙跳动的火光，古装夜戏与亲密氛围' },
  { id: 'neon', label: '霓虹混色光', en: 'mixed neon lighting', desc: '洋红与青蓝两色分打脸部，都市夜色' },
  { id: 'volumetric', label: '体积光（丁达尔）', en: 'volumetric god rays', desc: '光束穿过烟雾 / 树叶形成光柱，神圣与史诗' },
  { id: 'hard-sun', label: '正午硬光', en: 'harsh midday sun', desc: '高反差硬阴影，燥热、紧张、写实' },
]

/** 光比：亮面与暗面的亮度比 */
export const LIGHT_RATIOS: CineOption[] = [
  { id: '1:1', label: '1:1 平光', en: '1:1 flat lighting ratio', desc: '几乎没有阴影，明亮平淡，适合喜剧与综艺感' },
  { id: '2:1', label: '2:1 柔和光比', en: '2:1 soft lighting ratio', desc: '轻微立体，自然讨喜，适合甜宠与日常' },
  { id: '3:1', label: '3:1 戏剧光比', en: '3:1 dramatic lighting ratio', desc: '明暗分明但暗部有细节，电影剧情片常用' },
  { id: '4:1', label: '4:1 强立体光比', en: '4:1 high-contrast ratio', desc: '暗部明显压暗，悬疑、严肃、人物有心事' },
  { id: '8:1', label: '8:1 低调光比', en: '8:1 low-key ratio', desc: '大面积阴影，黑色电影、惊悚' },
  { id: '16:1', label: '16:1 明暗对照', en: '16:1 chiaroscuro', desc: '近乎剪影的明暗对照（chiaroscuro），极致戏剧' },
]

/** 硬性技术约束（可多选） */
export const TECH_CONSTRAINTS: CineOption[] = [
  { id: '4k-film', label: '4K 胶片渲染', en: '4K film render', desc: '4K 电影级成片清晰度' },
  { id: 'no-smoothing', label: '禁止 AI 磨皮', en: 'zero AI smoothing', desc: '保留皮肤与材质真实纹理，不要磨皮滤镜' },
  { id: 'no-plastic', label: '禁止 3D CG 塑料感', en: 'no 3D CG plastic look', desc: '不要游戏 CG、塑料皮肤、蜡像感' },
  { id: 'inertia', label: '物理正确的惯性与重量', en: 'physically correct inertia and weight', desc: '动作、衣物、道具有真实质量和惯性' },
  { id: 'no-motion-artifacts', label: '无运动模糊伪影', en: 'zero motion blur artifacts', desc: '快速动作不糊成一团、不拖影' },
  { id: 'hands', label: '手指完整', en: 'anatomically correct hands, five fingers', desc: '手部五指完整、比例正确' },
  { id: 'no-morph', label: '不变脸不变形', en: 'no face morphing, stable identity', desc: '人物五官全片稳定，不漂移' },
  { id: 'no-text', label: '画面无文字水印', en: 'no text, no subtitles, no watermark', desc: '画面里不出现文字、字幕、水印、logo' },
  { id: 'no-extra-people', label: '不凭空多人', en: 'no extra people appearing', desc: '不在画面里凭空多出路人或角色' },
  { id: 'no-vfx', label: '禁止额外特效', en: 'no added VFX, practical effects only', desc: '只要现场实拍效果，不加光效粒子特效' },
  { id: 'sync-sound', label: '仅同期声', en: 'diegetic sound only, no music', desc: '不要配乐、不要背景音乐和氛围音，只留同期声' },
  { id: 'lip-sync', label: '口型与台词对齐', en: 'accurate lip sync', desc: '说话口型与台词逐字对应' },
  { id: '24fps', label: '24 帧电影运动', en: '24fps cinematic motion cadence', desc: '24 帧电影动态，不是 60 帧视频感' },
  { id: 'hdr', label: '高动态范围', en: 'HDR, rich highlight and shadow detail', desc: '高光不过曝、暗部有细节' },
]

/** 景别 */
export const SHOT_SIZES: CineOption[] = [
  { id: 'els', label: '大远景', en: 'extreme long shot (ELS)', desc: '人物如蚂蚁，环境主导，交代世界与孤独' },
  { id: 'ls', label: '远景', en: 'long shot (LS)', desc: '人物全身较小，交代人与环境关系' },
  { id: 'fs', label: '全景', en: 'full shot (FS)', desc: '人物从头到脚完整入画，展示动作与服装' },
  { id: 'mls', label: '中全景（牛仔镜头）', en: 'cowboy shot (MLS)', desc: '大腿以上，动作与表情兼顾，西部片对峙经典' },
  { id: 'ms', label: '中景', en: 'medium shot (MS)', desc: '腰部以上，对话和互动的主力景别' },
  { id: 'mcu', label: '中近景', en: 'medium close-up (MCU)', desc: '胸部以上，看清表情又保留手势' },
  { id: 'cu', label: '特写', en: 'close-up (CU)', desc: '面部充满画面，情绪最强' },
  { id: 'ecu', label: '大特写', en: 'extreme close-up (ECU)', desc: '眼睛、嘴唇、手指等局部，放大微表情和细节' },
  { id: 'insert', label: '插入镜头', en: 'insert shot', desc: '道具、信件、手部动作的细节交代' },
  { id: 'two-shot', label: '双人镜头', en: 'two shot', desc: '两人同框，关系与距离感' },
  { id: 'group', label: '群像镜头', en: 'group shot', desc: '多人同框，阵营与对峙' },
  { id: 'establishing', label: '建立镜头', en: 'establishing shot', desc: '开场交代时间地点的环境镜头' },
]

/** 机位角度 */
export const CAMERA_ANGLES: CineOption[] = [
  { id: 'top-down', label: '上帝视角 90° 垂直俯拍', en: "bird's-eye view / top-down 90°", desc: '正上方垂直向下，图案化构图、宿命感' },
  { id: 'high', label: '高角度俯拍', en: 'high angle shot', desc: '从上往下看，人物显得弱小、被压迫' },
  { id: 'eye-level', label: '平视', en: 'eye-level shot', desc: '与人物视线齐平，客观平等' },
  { id: 'low-hero', label: '低角度英雄仰拍', en: 'low-angle hero shot', desc: '从下往上，人物高大有气场' },
  { id: 'worm', label: '虫视极低角度', en: "worm's-eye view", desc: '贴地仰拍，巨物压迫或夸张气势' },
  { id: 'dutch', label: '荷兰角（倾斜）', en: 'Dutch angle', desc: '画面倾斜，不安、失衡、疯狂' },
  { id: 'ots', label: '越肩镜头', en: 'over-the-shoulder shot (OTS)', desc: '从一人肩后拍另一人，对话的正反打' },
  { id: 'pov', label: '主观视角', en: 'POV shot', desc: '角色眼睛看到的画面，代入感' },
  { id: 'profile', label: '正侧面', en: 'profile shot', desc: '纯侧面剪影式构图，冷静、仪式感' },
  { id: 'three-quarter', label: '四分之三侧面', en: 'three-quarter angle', desc: '最立体的人像角度' },
  { id: 'back', label: '背面', en: 'from behind', desc: '看人物背影与他面对的世界，悬念与孤独' },
  { id: 'aerial', label: '航拍', en: 'aerial drone shot', desc: '高空大范围俯瞰，史诗开场' },
  { id: 'through-object', label: '穿物前景', en: 'shot through foreground objects', desc: '透过门缝、帘子、枝叶拍摄，窥视感与层次' },
]

/** 三维空间构图层次（每层写清放什么） */
export const COMPOSITION_LAYERS: CineOption[] = [
  { id: 'fg', label: '前景', en: 'foreground', desc: '离镜头最近的一层：雾、枝叶、虚化的肩膀或道具，制造纵深' },
  { id: 'fg-left', label: '左前景', en: 'left foreground', desc: '画面左侧近处的遮挡或人物局部' },
  { id: 'fg-right', label: '右前景', en: 'right foreground', desc: '画面右侧近处的遮挡或人物局部' },
  { id: 'mg-subject', label: '中景主体', en: 'midground subject', desc: '画面焦点所在的主角与主要动作' },
  { id: 'mg-left', label: '中景左侧', en: 'midground left', desc: '主体左边同一纵深的人物 / 物体' },
  { id: 'mg-right', label: '中景右侧', en: 'midground right', desc: '主体右边同一纵深的人物 / 物体' },
  { id: 'mg-back', label: '中后景', en: 'mid-background', desc: '主体后方的次要人物或空间延伸' },
  { id: 'bg-right', label: '右后景', en: 'right background', desc: '画面右侧远处的人物 / 景物' },
  { id: 'bg-left', label: '左后景', en: 'left background', desc: '画面左侧远处的人物 / 景物' },
  { id: 'bg', label: '背景', en: 'background', desc: '最远一层：天空、江面、城市灯火、墙面' },
]

/** 构图与焦点技巧 */
export const COMPOSITION_TECHNIQUES: CineOption[] = [
  { id: 'shallow-dof', label: '浅景深背景虚化', en: 'shallow depth of field, creamy bokeh', desc: '主体清楚、背景柔和化开，突出人物' },
  { id: 'deep-focus', label: '深焦全景深', en: 'deep focus', desc: '前后都清楚，多层叙事同时发生' },
  { id: 'fg-blur', label: '前景虚化', en: 'soft foreground blur', desc: '近处物体虚化做遮挡，窥视与层次' },
  { id: 'rack-focus', label: '动态拉焦', en: 'rack focus', desc: '焦点从一个人 / 物平滑转到另一个，引导视线' },
  { id: 'rule-of-thirds', label: '三分法', en: 'rule of thirds', desc: '主体放在三分线交点，平衡自然' },
  { id: 'symmetry', label: '中心对称', en: 'perfect central symmetry', desc: '绝对对称，仪式感、秩序或压迫' },
  { id: 'leading-lines', label: '引导线', en: 'leading lines', desc: '道路、栏杆、光束把视线引向主体' },
  { id: 'frame-in-frame', label: '框中框', en: 'frame within a frame', desc: '门窗、篷口框住人物，隔阂与孤独' },
  { id: 'negative-space', label: '大面积留白', en: 'negative space', desc: '主体很小、四周空旷，写意与孤独' },
  { id: 'silhouette', label: '剪影', en: 'silhouette against bright background', desc: '逆光下只见轮廓，神秘与诗意' },
  { id: 'diagonal', label: '对角线构图', en: 'diagonal composition', desc: '主体斜切画面，动感与张力' },
  { id: 'reflection', label: '倒影 / 镜像', en: 'reflection shot', desc: '水面、镜子里的倒影，双重身份与心理' },
  { id: 'depth-layers', label: '多层纵深', en: 'layered depth composition', desc: '前中后景都有内容，空间立体' },
]

/** 运镜 */
export const CAMERA_MOVES: CineOption[] = [
  { id: 'static', group: '基础', label: '固定机位', en: 'locked-off static shot', desc: '镜头不动，让表演说话，冷静克制' },
  { id: 'slow-dolly-in', group: '推拉', label: '极缓推进', en: 'slow dolly in', desc: '镜头慢慢靠近，情绪逐渐聚焦、压迫感上升' },
  { id: 'dolly-out', group: '推拉', label: '缓慢拉远', en: 'slow dolly out', desc: '镜头后退揭示环境，孤独或真相揭开' },
  { id: 'push-in-fast', group: '推拉', label: '急推', en: 'fast push-in', desc: '突然推近，震惊、顿悟的瞬间' },
  { id: 'dolly-zoom', group: '推拉', label: '希区柯克变焦', en: 'dolly zoom (vertigo effect)', desc: '人物大小不变背景拉伸，眩晕与心理震荡' },
  { id: 'zoom-in', group: '推拉', label: '变焦推近', en: 'slow zoom in', desc: '光学变焦推近，复古 70 年代味道' },
  { id: 'lateral-tracking', group: '移动', label: '横移跟拍', en: 'lateral tracking shot', desc: '与人物 / 船 / 车同步平行横移，旁观的流动感' },
  { id: 'follow', group: '移动', label: '跟随拍摄', en: 'follow shot from behind', desc: '跟在人物身后前进，带观众进入空间' },
  { id: 'leading', group: '移动', label: '倒退引导', en: 'leading shot, camera walks backward', desc: '镜头在人物前方后退，看着他走来' },
  { id: 'steadicam', group: '移动', label: '斯坦尼康长镜头', en: 'Steadicam long take', desc: '平滑流畅的一镜到底，穿梭空间' },
  { id: 'arc', group: '移动', label: '环绕运镜', en: '180° arc shot around subject', desc: '绕人物旋转，高光时刻与关系转变' },
  { id: 'orbit-360', group: '移动', label: '360° 环绕', en: '360-degree orbit', desc: '完整环绕，眩目、命运交汇' },
  { id: 'crane-up', group: '升降', label: '升镜（摇臂上升）', en: 'crane up', desc: '镜头升起俯瞰，抽离、结局、宏大' },
  { id: 'crane-down', group: '升降', label: '降镜（摇臂下降）', en: 'slow crane down', desc: '从高空降到人物，进入故事' },
  { id: 'top-down-spiral', group: '升降', label: '俯拍螺旋下推', en: 'top-down ultra-slow clockwise roll with vertical push-in', desc: '高空垂直俯视，极缓顺时针旋转同时下推，宿命感与写意' },
  { id: 'pedestal', group: '升降', label: '垂直升降（Pedestal）', en: 'pedestal up/down', desc: '机身垂直升降不改变角度，平稳揭示' },
  { id: 'pan', group: '摇移', label: '水平摇镜', en: 'slow pan', desc: '机位不动左右摇，扫视环境或跟随视线' },
  { id: 'tilt', group: '摇移', label: '垂直摇镜', en: 'tilt up / tilt down', desc: '上下摇，从脚到脸揭示人物或仰望高处' },
  { id: 'whip-pan', group: '摇移', label: '甩镜', en: 'whip pan', desc: '极快甩动，转场或追随突发动作' },
  { id: 'roll', group: '摇移', label: '旋转（Roll）', en: 'camera roll', desc: '画面绕光轴旋转，失重、梦境、混乱' },
  { id: 'handheld-breath', group: '手持', label: '呼吸感手持', en: 'subtle handheld camera movement', desc: '极轻微晃动，真实临场、紧张亲密' },
  { id: 'handheld-shaky', group: '手持', label: '剧烈手持', en: 'aggressive handheld shaky cam', desc: '强烈晃动，打斗、追逐、慌乱' },
  { id: 'snorricam', group: '手持', label: '身体绑定镜头', en: 'snorricam body-mounted', desc: '镜头绑在人物身上，主观眩晕、醉酒崩溃' },
  { id: 'fpv-dive', group: '特殊', label: 'FPV 俯冲穿越', en: 'FPV drone dive', desc: '高速俯冲穿越缝隙，冲击力极强' },
  { id: 'drone-reveal', group: '特殊', label: '航拍揭示', en: 'drone reveal pull-back', desc: '从人物拉高拉远，揭示宏大环境' },
  { id: 'bullet-time', group: '特殊', label: '子弹时间', en: 'bullet time freeze orbit', desc: '时间凝固镜头环绕，动作高光' },
  { id: 'slow-motion', group: '特殊', label: '升格慢动作', en: '120fps slow motion', desc: '动作放慢，强调重量与情绪' },
  { id: 'speed-ramp', group: '特殊', label: '变速', en: 'speed ramp', desc: '快—慢—快的节奏变化，动作片的爆点' },
  { id: 'rack-focus-move', group: '特殊', label: '拉焦转移', en: 'rack focus shift', desc: '镜头不动、焦点在前后人物之间转移' },
  { id: 'crash-zoom', group: '特殊', label: '急速变焦', en: 'crash zoom', desc: '突然快速变焦推近，喜剧或震惊效果' },
]

/** 微观表演（面部 / 肢体细节） */
export const MICRO_PERFORMANCES: CineOption[] = [
  { id: 'brow-relax', group: '眉眼', label: '眉头舒展', en: 'brows relax', desc: '紧张释放、释然洒脱' },
  { id: 'brow-knit', group: '眉眼', label: '眉头紧锁', en: 'knitted brows', desc: '烦恼、不服、愤怒前兆' },
  { id: 'eye-corner-lift', group: '眉眼', label: '眼尾微挑', en: 'eye corners lift slightly', desc: '狡黠、调皮、挑衅' },
  { id: 'pupil-contract', group: '眉眼', label: '瞳孔骤缩', en: 'pupils contract sharply', desc: '警觉、杀气、惊恐' },
  { id: 'pupil-dilate', group: '眉眼', label: '瞳孔放大', en: 'pupils dilate', desc: '渴望、惊喜、被吸引' },
  { id: 'side-glance', group: '眉眼', label: '斜眼瞥视', en: 'sidelong glance', desc: '轻蔑、怀疑、偷看' },
  { id: 'eyes-moist', group: '眉眼', label: '眼眶泛红含泪', en: 'eyes well up with tears', desc: '隐忍的悲伤与委屈' },
  { id: 'slow-blink', group: '眉眼', label: '缓慢眨眼', en: 'slow deliberate blink', desc: '思考、冷静、无声的回应' },
  { id: 'mouth-curl', group: '口鼻', label: '嘴角轻勾', en: 'corner of the mouth curls up', desc: '似笑非笑、自信、清冷孤傲' },
  { id: 'lips-press', group: '口鼻', label: '双唇紧抿', en: 'lips pressed tight', desc: '憋笑、忍耐、压住情绪' },
  { id: 'nostril-flare', group: '口鼻', label: '鼻翼翕动', en: 'nostrils flare', desc: '暴怒、急促呼吸、嗅闻' },
  { id: 'lip-lick', group: '口鼻', label: '舌尖抿唇', en: 'tongue tip wets the lips', desc: '馋、紧张、欲言又止' },
  { id: 'jaw-clench', group: '面部', label: '咬紧牙关', en: 'jaw clenches', desc: '隐忍的愤怒与决心' },
  { id: 'cheek-twitch', group: '面部', label: '腮帮抽搐', en: 'cheek muscles twitch', desc: '拼命憋笑或压住怒火' },
  { id: 'chin-raise', group: '面部', label: '下颌微扬', en: 'chin lifts slightly', desc: '骄傲、自信、睥睨' },
  { id: 'veins', group: '面部', label: '青筋暴起', en: 'veins bulge on the forehead', desc: '暴怒、用力' },
  { id: 'adam-apple', group: '面部', label: '喉结滑动', en: "Adam's apple bobs as he swallows", desc: '吞咽、紧张、垂涎' },
  { id: 'shoulders-shake', group: '肢体', label: '双肩耸动', en: 'shoulders shake', desc: '憋笑、抽泣' },
  { id: 'shoulders-relax', group: '肢体', label: '双肩松弛', en: 'shoulders loose and relaxed', desc: '从容、潇洒、放松' },
  { id: 'chest-heave', group: '肢体', label: '胸口起伏', en: 'chest heaves', desc: '激动、愤怒、喘息' },
  { id: 'fingers-spread', group: '肢体', label: '五指自然微张', en: 'fingers naturally spread', desc: '舒展、潇洒的手势' },
  { id: 'fist-tighten', group: '肢体', label: '攥紧拳头', en: 'fist tightens', desc: '克制的愤怒与决心' },
  { id: 'hand-on-hilt', group: '肢体', label: '手按剑柄', en: 'hand rests on the sword hilt', desc: '戒备、随时出手' },
  { id: 'weight-shift', group: '肢体', label: '重心下压蓄力', en: 'lowers center of gravity, coiled to spring', desc: '如猎豹般准备弹射' },
  { id: 'sleeve-slide', group: '肢体', label: '袖口受重力滑落', en: 'sleeve slides down with gravity', desc: '抬手时宽袖自然滑落露出手腕，真实物理' },
]

/** 氛围细节（环境与物理） */
export const ATMOSPHERE_DETAILS: CineOption[] = [
  { id: 'hair-wind', label: '碎发被风吹动', en: 'loose strands of hair stir in the wind', desc: '风的方向一致，增加生命感' },
  { id: 'fabric-wind', label: '衣摆围巾随风拂动', en: 'garment hems and scarf flutter', desc: '布料有重量地飘动' },
  { id: 'tassel-sway', label: '剑穗 / 挂饰随惯性摇曳', en: 'tassels sway with inertia', desc: '小配件随运动惯性摆动' },
  { id: 'mist-flow', label: '江雾 / 薄雾流动', en: 'drifting volumetric mist', desc: '雾有体积和流向，层次感' },
  { id: 'rain', label: '雨丝与溅水', en: 'rain streaks and splashes', desc: '雨夜情绪与湿润质感' },
  { id: 'snow', label: '飘雪', en: 'falling snow', desc: '冷寂、纯净、时间流逝' },
  { id: 'dust-motes', label: '光束里的浮尘', en: 'dust motes in light beams', desc: '室内光柱中漂浮的微尘，静谧' },
  { id: 'embers', label: '火星飞溅', en: 'floating embers', desc: '战斗、篝火、毁灭' },
  { id: 'petals', label: '花瓣 / 落叶飘落', en: 'falling petals and leaves', desc: '唯美、离别、季节' },
  { id: 'candle-flicker', label: '烛火摇曳', en: 'candle flames flicker', desc: '光影在脸上跳动' },
  { id: 'water-ripple', label: '水波粼粼', en: 'rippling water reflections', desc: '水面反光在人物身上游动' },
  { id: 'shadow-drift', label: '篷顶 / 树叶阴影游移', en: 'dappled shadows drift across faces', desc: '随物体晃动，阴影在脸和衣褶间缓慢游走' },
  { id: 'breath-fog', label: '呼出白气', en: 'visible breath in cold air', desc: '寒冷天气的真实感' },
  { id: 'sweat', label: '汗珠 / 水珠滑落', en: 'beads of sweat / droplets roll down', desc: '紧张、炎热、刚出水' },
  { id: 'smoke', label: '烟雾缭绕', en: 'curling smoke', desc: '香炉、香烟、战场硝烟' },
  { id: 'lens-flare', label: '镜头眩光', en: 'natural lens flare', desc: '迎光时的电影眩光' },
]

/** 面部明暗与立体塑造的写法参考（界面里点一下填进对应输入框） */
export const LIGHTING_SNIPPETS = {
  terminator: [
    '沿高挺鼻梁与下颌线柔化过渡',
    '明暗交界线锐利，切开半张脸，制造悬疑',
    '从颧骨斜下到嘴角，柔和渐变',
    '暗侧脸颊形成伦勃朗三角光斑',
    '幽暗环境与侧光切割下呈现强烈肌理反差',
  ],
  fill: [
    '水面冷调漫反射提亮阴影侧',
    '白墙暖色反光补亮暗部',
    '不补光，暗部保持深沉',
    '地面雪地高反射，脸部下方被照亮',
    '霓虹招牌的彩色溢光落在阴影侧',
    '皮肤具真实次表面散射（SSS），耳廓与鼻翼透光',
    '发丝带水汽轮廓光',
  ],
  dynamic: [
    '船体随水波微晃，篷顶阴影在人物面部与衣褶间缓慢游移',
    '树叶缝隙的光斑随风在脸上闪动',
    '百叶窗条纹阴影横切人物',
    '烛火跳动让面部光影忽明忽暗',
    '车窗外路灯光一道道扫过脸庞',
    '云影掠过，光线由明转暗',
  ],
  materials: [
    'natural skin micro-pores 真实皮肤毛孔与汗渍',
    '粗麻毛边随风微颤',
    '丝绸反光柔滑、随动作流动',
    '皮革有磨损折痕与油光',
    '金属有划痕与环境反射',
    '雾气具备真实流体体积感与惯性重力',
    '湿发成缕贴在额角',
  ],
}

/** 人物字段快捷选项 */
export const CHARACTER_PICKS = {
  gender: ['女', '男', '少女', '少年', '中性', '非人类'],
  age: ['5岁左右', '10岁左右', '16岁左右', '20岁左右', '25岁左右', '30岁左右', '35岁左右', '40岁左右', '50岁左右', '60岁左右', '70岁以上'],
  face: ['鹅蛋脸', '瓜子脸', '圆脸', '方脸', '国字脸', '长脸', '菱形脸', '心形脸', '圆脸双下巴', '颧骨高耸双颊凹陷', '棱角分明', '娃娃脸'],
  hair: ['高盘凌乱丸子头', '高马尾', '低马尾', '披肩长直发', '大波浪卷发', '齐耳短发', '寸头', '背头', '道士发髻', '古装束发戴冠', '散落湿润碎发', '光头', '头裹粗布巾', '头系黑布条', '双麻花辫', '公主切'],
  style: ['清冷飒爽', '温婉柔美', '英气逼人', '邪魅狂狷', '憨厚老实', '滑稽喜感', '阴鸷狠辣', '饱经风霜', '高冷禁欲', '阳光开朗', '贵气雍容', '落魄潦倒', '书卷气', '江湖痞气'],
  outfit: ['粗麻交领长袍', '破边粗麻围巾披风', '黑色破旧粗布短打', '锦缎华服', '飞鱼服', '道袍', '旗袍', '长衫马褂', '西装三件套', '风衣礼帽', '白衬衫牛仔裤', '职业套装', '校服', '机能风夹克', '铠甲', '夜行衣'],
}

export const CINEMATIC_OPTIONS = {
  styleAnchors: STYLE_ANCHORS,
  cameras: CAMERAS,
  lenses: LENSES,
  focalLengths: FOCAL_LENGTHS,
  filmStocks: FILM_STOCKS,
  aspectRatios: ASPECT_RATIOS,
  palettes: PALETTES,
  keyLights: KEY_LIGHTS,
  lightRatios: LIGHT_RATIOS,
  techConstraints: TECH_CONSTRAINTS,
  shotSizes: SHOT_SIZES,
  cameraAngles: CAMERA_ANGLES,
  compositionLayers: COMPOSITION_LAYERS,
  compositionTechniques: COMPOSITION_TECHNIQUES,
  cameraMoves: CAMERA_MOVES,
  microPerformances: MICRO_PERFORMANCES,
  atmosphereDetails: ATMOSPHERE_DETAILS,
  lightingSnippets: LIGHTING_SNIPPETS,
  characterPicks: CHARACTER_PICKS,
}

export type OptionListKey = Exclude<keyof typeof CINEMATIC_OPTIONS, 'palettes' | 'lightingSnippets' | 'characterPicks'>

export function findOption(list: CineOption[], id: string): CineOption | undefined {
  return list.find((o) => o.id === id)
}
