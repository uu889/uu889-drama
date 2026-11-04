---
name: character-reference-sheet
description: 角色参考图：一张正面全身锚点做根，大头照、侧面、背面只参考锚点；出图提示词英文、不写人名、不写画风词
source: shuohao-skills · character-refs / novel-characters
source_url: https://github.com/eternityspring/shuohao-skills
---

# 角色参考图

给角色出一组参考图，用于后续分镜关键帧和视频生成保持人物一致。

## 核心规则

- **一组图只有一个根：正面全身锚点。** 只有锚点是文生图，其余每张都是「锚点 + 一句改图指令」。图与图之间不互相参考，任何一张坏了单独重出，不会连锁。
- **锚点没确认，不出派生图。** 锚点是全组的根，它不对后面全白出。
- **大头照必出**：实测只给全身参考，服装和背影能对，脸会走样；加一张正脸大头照，脸最接近。
- **模型可以混用**：一致性来自同一张锚点，不来自同一个模型。
- **锚点换了，派生图标过期，旧图保留不删。**

## 分档

| 档 | 内容 | 什么时候出 |
|---|---|---|
| 1 | 正面全身（锚点），纯白底 | 总是第一张 |
| 2（默认） | 正脸大头照、90° 侧面、背面 | 默认出齐 |
| 3 | 细节图 ≤8 张：用户点名的、最能认出这个角色的地方；默认头发 / 发饰、领口、袖口、鞋 | 有配饰或服装局部特写时 |
| 4 | 45° 大头照 | 用户明确要 |

## 拆描述

用户一段话描述角色就够，不要一项一项问。拆成字段：年龄、性别、年代、体型、脸型、五官、发型发色、肤色、上装、下装、鞋、配饰、标志性特征。

- **只有年龄、性别、年代推不出来时才问**，其余自己补并标注来源（用户说的 / 推断的 / 默认的），确认表里提醒用户看推断项。
- **服装分上下装**：大头照只写上装；带上下装模型会把镜头拉远。
- 脸上的特征不出细节图（大头照已看得清）。

## 提示词写法

- **永远英文**、**不写角色名**（人名会被画成文字或混淆身份）、**不写画风词**（画风由项目统一附加，同一部剧所有角色同一个画风）。
- 锚点：`full body, standing, front view, centered, pure white seamless background, even diffuse lighting, no cast shadow, [字段描述]`。
- 派生：`same character as reference image, [view: close-up head and shoulders, front / 90-degree profile facing right / back view], keep face, hairstyle, hair color, skin tone and outfit identical`。
- 角色设定图（单张版面）：左半身像 + 右全身三视图 + 细节条时，提示词写死「one single character only, the same person in every view, do not squash proportions」，防一张图两个长相。

## 防全剧人物趋同

同批角色一起设计，逐条写出每个角色和其他人在**结构**上的不同：下颌线、眼型与瞳孔高光形状、发型分层与发色渐变位置、固定配件。「清冷美人」不是锚点；「下颌比同组更方、瞳孔上缘横条高光、左耳一枚银环」才是。
