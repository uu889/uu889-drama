---
name: storyboard-breaker
description: Professional rules for storyboard breakdown — splitting a script into storyboard segments that each carry multiple sub-shots
---

# Storyboard Breakdown Guide

## Core Definition: Storyboard Segment

One storyboard = one **storyboard segment** = one video-generation task.

- Segment length is driven by dialogue and action: **4-15 seconds**, carrying **1-4 sub-shots**
- Cuts between sub-shots **are allowed**: change shot size, angle, or subject, joined with hard cuts
- Sub-shots **never cross scenes**: a segment takes place in a single scene (`scene_id` is a segment-level binding)
- Each sub-shot is 2-6 seconds, focused on one visual unit (one action, one reaction, one close-up)

## Breakdown Process (Four Steps)

1. Call `read_storyboard_context` to read the script, characters, scenes, props, and existing storyboard summaries
2. **Beat identification**: first identify the script's narrative beats — markers such as [Opening] [Trigger] [Climax] [Resolution], or narrative turning points (location changes, rule reveals, emotional eruptions, reversals). **Beat boundaries force a segment cut**; group sub-shots within the same beat into the same segment where possible, and do not scatter a causal chain (setup-event-reaction) across different segments
3. **Total-volume anchoring**: target total duration = script character count ÷ 500 characters/minute; segment count ≈ target total duration ÷ 12 seconds, with ±20% tolerance. Do not significantly overshoot or undershoot
4. **Split sub-shots within each segment**: cut sub-shots at action-change points, viewpoint-change points, and subject-change points; after filling in all fields for each segment, call `save_storyboards` to save them in one go

## Duration Follows the Dialogue (Hard Rule)

**Segments with dialogue: duration ≈ words ÷ 2.5 per second (CJK: characters ÷ 4.5 per second) + 0.8 s per change of speaker + 0.5 s lead-in + 1 s tail (±2 s)**

- A segment with 5 seconds of lines gets 6-8 seconds, **not 10**: whenever nobody is scripted to speak, the video model invents lines and produces gibberish
- Any stretch over 3 seconds without dialogue must be written in `description` as concrete visible action or reaction (standing up, handing something over, a silent look, smoothing a sleeve)
- If the lines do not fit, split into several consecutive segments in the same scene; never put a short exchange into a long segment
- On save the system checks the timing: segments too short for their lines are lengthened automatically; segments with too much idle time are listed in `timing_warnings` — shorten them or add action with `update_storyboard`

| Segment type | Duration | Notes |
|---|---|---|
| Dialogue | From the lines | Each line + speaker-change pauses + reactions, idle ≤ 3 s |
| Action / transition | 4-10 s | Travel, establishing shots, transitions — visible action every second |
| Payoff | 8-15 s | Close-ups, reveals, emotional eruptions, reversals — slower, but filled with expressions and action, never empty |

## Dialogue Rhythm (Hard Rule)

- At most **4 lines** per segment; each line belongs to one sub-shot and never breaks across segments
- **The speaker is on camera** (medium close-up / over-the-shoulder); write the listener's reaction between lines (a nod, a frown, a silent beat) — no rapid fire, no overlapping speech
- **Shot / reverse shot + 180-degree rule**: fix left and right in `blocking` when the conversation starts (e.g. Ming frame left, Hong frame right) and keep it for every segment of the conversation
- Narration is a voice-over: write "Narration: content"; nobody on screen speaks during it

## Blocking and Continuity (Hard Rule)

- Fill `blocking` for every segment: "Opening: each on-screen character's position (left/center/right, foreground/background), facing, posture, props in hand" and "End: where each character is and what they are doing at the end"
- **In consecutive segments of the same scene, the opening equals the previous segment's end**: no teleporting, vanishing or swapping places; a prop stays with whoever holds it
- Character looks follow the character sheet: no clothes, hair or accessories that differ from it; no outfit changes the script does not call for
- Keep time of day, lighting and weather consistent across consecutive segments in a scene; no style words that contradict the project style
- When videos are generated, the system feeds the previous shot's last frame in the same scene as the first frame / a reference and appends blocking, character and style locks — the more concrete `blocking` is, the better the shots cut together

## Shot Elements

1. **Shot title**: a 3-5-character summary of the segment's core content (e.g. "Nightmare Awakening")
2. **Time**: specific time of day + lighting description
3. **Location**: full scene description + spatial layout + environmental details
4. **Shot size**: the dominant shot size of the segment; for multi-size segments write a combination, e.g. "medium shot + close-up"
5. **Angle**: eye-level / low angle / high angle / side / back
6. **Camera move**: static / push-in / pull-back / pan / tracking / dolly (different sub-shots within a segment may differ)
7. **Visual description** `description`: describe sub-shot by sub-shot as `【镜头1】…【镜头2】…` what the audience actually sees and hears — the visuals (who + specific action + body-language details + expression) come first; when a sub-shot has dialogue, write it inside the corresponding `【镜头N】` as "CharacterName says: "line"", and narration as "Narration: content"
8. **Visual result** `result`: the immediate consequence at the end of the segment + visual details
9. **Atmosphere** `atmosphere`: lighting + color tone + sound + overall mood
10. **Duration** `duration`: 4-15 seconds, set by the "duration follows the dialogue" rule — never pad it
11. **Scene binding**: if it can be matched to an existing scene, `scene_id` must be filled in
12. **Character binding**: fill in `character_ids`, binding 0 to multiple characters involved in this segment
13. **Prop binding**: fill in `prop_ids`, binding 0 to multiple key props appearing in this segment
14. **Blocking** `blocking`: two sentences, "Opening: …" and "End: …", giving each character's screen position (left/center/right, foreground/background), facing, posture and props in hand; the next segment in the same scene opens where this one ends

## Scene Binding Rules

- Prefer the `scenes` returned by `read_storyboard_context`
- When `location + time` can be clearly matched, the correct `scene_id` must be filled in
- Do not fabricate scene IDs that do not exist
- If the script content clearly falls within an existing scene, do not create a duplicate new scene description

## Character Binding Rules

- `character_ids` must be chosen from the character list returned by `read_storyboard_context`
- A segment may have no characters, or may bind multiple characters
- Any character with a clear appearance in the segment — seen, acting, or speaking — should be bound
- Pure-environment segments, empty shots, and object close-ups may pass an empty array

## Prop Binding Rules

- `prop_ids` must be chosen from the prop list (`props`) returned by `read_storyboard_context`
- When a prop is used by a character, handed over, shown in close-up, or clearly visible in frame and meaningful to the narrative, it must be bound to that segment
- Prop close-up segments (without characters) should also bind the prop; `character_ids` may be empty
- Do not bind background items or set dressing irrelevant to the plot; segments with no props pass an empty array
- Bound props serve as reference images for video generation (white-background product shots), keeping the prop's appearance consistent across segments

## Quality Requirements

- **Actions must be filmable and physically plausible**: one simple action per sub-shot, with start, motion, end and body contact (where feet stand, what hands hold, what the body leans on); show a prop being picked up before it is held; split fights, running, throwing / catching into several sub-shots or shots. Vague or stacked actions are what make video models clip, float and morph

- `description` should be human-readable, describing sub-shot by sub-shot what the audience actually sees and hears; dialogue/narration is written directly inside the corresponding `【镜头N】`
- `image_prompt` should highlight the single-frame composition, character appearance, environment, and lighting (corresponding to the segment's first sub-shot)
- `bgm_prompt` and `sound_effect` may be concise phrases, but must not be as vague as just "tense" or "sad"
- To make adjustments, call `update_storyboard` to modify the specific segment
