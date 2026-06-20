export type JointId = 
  | 'left_shoulder' 
  | 'right_shoulder' 
  | 'left_elbow' 
  | 'right_elbow' 
  | 'left_hip' 
  | 'right_hip' 
  | 'left_knee' 
  | 'right_knee'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_ankle'
  | 'right_ankle';

export type Severity = 'mild' | 'moderate' | 'severe';

export interface PhraseEntry {
  joint: JointId;
  severity: Severity;
  midMovement: string[];
  afterAction: string[];
  praiseWhenFixed: string[];
}

export const PhraseDatabase: Record<JointId, Record<Severity, Omit<PhraseEntry, 'joint' | 'severity'>>> = {
  left_shoulder: {
    mild: {
      midMovement: ["Watch the left shoulder.", "Left shoulder placement.", "Check left shoulder."],
      afterAction: ["Your left shoulder drifted slightly out of alignment. Keep it engaged."],
      praiseWhenFixed: ["Good shoulder placement.", "Left shoulder looks great."]
    },
    moderate: {
      midMovement: ["Left shoulder up!", "Lift the left shoulder.", "Raise left side."],
      afterAction: ["You need to elevate your left shoulder to match the horizontal line."],
      praiseWhenFixed: ["Much better on the left shoulder!", "That is the right height."]
    },
    severe: {
      midMovement: ["Raise that left shoulder!", "Left shoulder dropping!", "Lift the left!"],
      afterAction: ["Your left shoulder completely dropped. Focus on keeping it elevated."],
      praiseWhenFixed: ["There it is! Perfect shoulder height.", "Excellent correction."]
    }
  },
  right_shoulder: {
    mild: {
      midMovement: ["Level the right shoulder.", "Right shoulder check.", "Watch the right."],
      afterAction: ["Pay attention to the slight dip in your right shoulder."],
      praiseWhenFixed: ["Nice right shoulder control.", "Right side is solid."]
    },
    moderate: {
      midMovement: ["Right shoulder higher!", "Push the right shoulder up.", "Lift right!"],
      afterAction: ["Your right shoulder needs more elevation on that extension."],
      praiseWhenFixed: ["Great adjustment on the right shoulder.", "Right shoulder fixed."]
    },
    severe: {
      midMovement: ["Lift your right shoulder!", "Right shoulder is lost!", "Pull up right!"],
      afterAction: ["You are losing the frame on your right side. Lift from the joint."],
      praiseWhenFixed: ["Yes! Right shoulder is locked in.", "Beautifully leveled."]
    }
  },
  left_elbow: {
    mild: {
      midMovement: ["Soften left elbow.", "Left elbow line.", "Check left arm."],
      afterAction: ["Your left elbow is a bit too stiff, try to soften the line."],
      praiseWhenFixed: ["Good elbow shape.", "Nice line on the left."]
    },
    moderate: {
      midMovement: ["Bend left elbow!", "Shape the left arm.", "Curve the left!"],
      afterAction: ["You are locking your left elbow. Keep a natural, soft bend."],
      praiseWhenFixed: ["That is the right elbow angle!", "Perfect bend."]
    },
    severe: {
      midMovement: ["Unlock left elbow!", "Bend it left!", "Left arm too straight!"],
      afterAction: ["Your left arm is completely straight. It needs a distinct bend."],
      praiseWhenFixed: ["Excellent! Left elbow is fixed.", "Much better arm shape."]
    }
  },
  right_elbow: {
    mild: {
      midMovement: ["Right elbow check.", "Right arm shape.", "Soften the right."],
      afterAction: ["Keep an eye on the angle of your right elbow."],
      praiseWhenFixed: ["Nice shape on the right arm.", "Right elbow is good."]
    },
    moderate: {
      midMovement: ["Straighten right elbow!", "Extend right arm.", "Reach right!"],
      afterAction: ["You need more extension through your right elbow on that beat."],
      praiseWhenFixed: ["Much better extension there.", "Great reach."]
    },
    severe: {
      midMovement: ["Reach right fully!", "Straighten the right!", "Right arm out!"],
      afterAction: ["Your right arm is too bent. Reach fully outward to complete the line."],
      praiseWhenFixed: ["Beautiful reach on the right side!", "Full extension, perfect."]
    }
  },
  left_hip: {
    mild: {
      midMovement: ["Square left hip.", "Left hip placement.", "Watch left hip."],
      afterAction: ["Your left hip is rotating slightly outward. Keep it squared."],
      praiseWhenFixed: ["Hips are squared nicely.", "Good hip alignment."]
    },
    moderate: {
      midMovement: ["Turn left hip in!", "Left hip forward.", "Square up left!"],
      afterAction: ["Bring your left hip forward to square your pelvis to the front."],
      praiseWhenFixed: ["Good hip rotation.", "Left hip is back in place."]
    },
    severe: {
      midMovement: ["Left hip is open!", "Square your hips!", "Close the left hip!"],
      afterAction: ["Your left hip is completely open, breaking the line. Square up."],
      praiseWhenFixed: ["Perfectly squared hips now!", "Excellent pelvic control."]
    }
  },
  right_hip: {
    mild: {
      midMovement: ["Right hip check.", "Watch right hip.", "Level the right hip."],
      afterAction: ["Notice the slight drop in your right hip. Keep it level."],
      praiseWhenFixed: ["Right hip looks solid.", "Good level on the hips."]
    },
    moderate: {
      midMovement: ["Lift right hip!", "Right side up.", "Pull up right hip!"],
      afterAction: ["You are sinking into your right hip. Pull up from the core."],
      praiseWhenFixed: ["Much better weight distribution.", "Great hip lift."]
    },
    severe: {
      midMovement: ["Pull right hip up!", "Don't sink right!", "Lift the right side!"],
      afterAction: ["You are collapsing onto your right hip. Engage your core to lift it."],
      praiseWhenFixed: ["Great lift on the right side!", "Hips are perfectly level."]
    }
  },
  left_knee: {
    mild: {
      midMovement: ["Soften left knee.", "Left knee check.", "Watch the left leg."],
      afterAction: ["Your left knee is slightly stiff on the landing. Soften it."],
      praiseWhenFixed: ["Good bend in the left knee.", "Nice soft landing."]
    },
    moderate: {
      midMovement: ["Bend left knee!", "Plie left.", "Sink into the left!"],
      afterAction: ["You need a deeper bend in your left knee for stability."],
      praiseWhenFixed: ["Nice depth on the left side.", "Great plie."]
    },
    severe: {
      midMovement: ["Left knee deep!", "Bend the left!", "Don't lock the left!"],
      afterAction: ["Your left leg is totally stiff. You must bend the knee to absorb the movement."],
      praiseWhenFixed: ["Excellent plie on the left!", "Much safer knee bend."]
    }
  },
  right_knee: {
    mild: {
      midMovement: ["Watch your right knee.", "Check your right knee.", "Right knee alignment."],
      afterAction: ["Your right knee was slightly out of place. Remember to track it over your toes."],
      praiseWhenFixed: ["Right knee tracking is perfect now.", "Great adjustment on that right knee."]
    },
    moderate: {
      midMovement: ["Fix the right knee.", "Bend that right knee.", "Adjust right knee."],
      afterAction: ["Your right knee bent too far inwards. Focus on pushing it outwards during the plié."],
      praiseWhenFixed: ["Much better stability on the right knee.", "Nice deep bend on the right knee."]
    },
    severe: {
      midMovement: ["Right knee is way off!", "Watch that right knee!", "Don't let the right knee cave!"],
      afterAction: ["We need to completely reset your right knee alignment. It's collapsing inwards, which is dangerous. Push it out."],
      praiseWhenFixed: ["That's it! Right knee is totally safe and aligned now."]
    }
  },
  left_wrist: {
    mild: {
      midMovement: ["Check left wrist.", "Watch left wrist.", "Left wrist alignment."],
      afterAction: ["Your left wrist was slightly bent. Try to keep a straight line."],
      praiseWhenFixed: ["Perfect left wrist alignment now."]
    },
    moderate: {
      midMovement: ["Straighten left wrist.", "Fix left wrist.", "Adjust left wrist."],
      afterAction: ["Your left wrist broke alignment. Keep the energy flowing through your fingertips."],
      praiseWhenFixed: ["Much better control on the left wrist."]
    },
    severe: {
      midMovement: ["Left wrist is breaking!", "Strong left wrist!", "Don't drop the left wrist!"],
      afterAction: ["Your left wrist was completely collapsed. You lose all power when the wrist breaks. Keep it strong."],
      praiseWhenFixed: ["Excellent power through the left wrist now!"]
    }
  },
  right_wrist: {
    mild: {
      midMovement: ["Check right wrist.", "Watch right wrist.", "Right wrist alignment."],
      afterAction: ["Your right wrist was slightly bent. Try to keep a straight line."],
      praiseWhenFixed: ["Perfect right wrist alignment now."]
    },
    moderate: {
      midMovement: ["Straighten right wrist.", "Fix right wrist.", "Adjust right wrist."],
      afterAction: ["Your right wrist broke alignment. Keep the energy flowing through your fingertips."],
      praiseWhenFixed: ["Much better control on the right wrist."]
    },
    severe: {
      midMovement: ["Right wrist is breaking!", "Strong right wrist!", "Don't drop the right wrist!"],
      afterAction: ["Your right wrist was completely collapsed. You lose all power when the wrist breaks. Keep it strong."],
      praiseWhenFixed: ["Excellent power through the right wrist now!"]
    }
  },
  left_ankle: {
    mild: {
      midMovement: ["Check left ankle.", "Watch left ankle.", "Left ankle alignment."],
      afterAction: ["Your left ankle rolled slightly. Keep your weight centered."],
      praiseWhenFixed: ["Perfect left ankle stability now."]
    },
    moderate: {
      midMovement: ["Support left ankle.", "Fix left ankle.", "Adjust left ankle."],
      afterAction: ["Your left ankle is rolling inwards. Think about lifting your arch."],
      praiseWhenFixed: ["Much better support on the left ankle."]
    },
    severe: {
      midMovement: ["Left ankle is rolling!", "Strong left ankle!", "Don't drop the left ankle!"],
      afterAction: ["Your left ankle collapsed entirely. This is how sprains happen. Pull up through your leg."],
      praiseWhenFixed: ["Excellent strength in the left ankle now!"]
    }
  },
  right_ankle: {
    mild: {
      midMovement: ["Check right ankle.", "Watch right ankle.", "Right ankle alignment."],
      afterAction: ["Your right ankle rolled slightly. Keep your weight centered."],
      praiseWhenFixed: ["Perfect right ankle stability now."]
    },
    moderate: {
      midMovement: ["Support right ankle.", "Fix right ankle.", "Adjust right ankle."],
      afterAction: ["Your right ankle is rolling inwards. Think about lifting your arch."],
      praiseWhenFixed: ["Much better support on the right ankle."]
    },
    severe: {
      midMovement: ["Right ankle is rolling!", "Strong right ankle!", "Don't drop the right ankle!"],
      afterAction: ["Your right ankle collapsed entirely. This is how sprains happen. Pull up through your leg."],
      praiseWhenFixed: ["Excellent strength in the right ankle now!"]
    }
  }
};

export class PhraseGenerator {
  private usedPhrases: Map<string, string[]> = new Map();

  getUniquePhrase(joint: JointId, severity: Severity, context: 'midMovement' | 'afterAction' | 'praiseWhenFixed'): string {
    const key = `${joint}_${severity}_${context}`;
    const allPhrases = PhraseDatabase[joint]?.[severity]?.[context] || [];
    
    if (allPhrases.length === 0) return '';

    let used = this.usedPhrases.get(key) || [];
    let available = allPhrases.filter(p => !used.includes(p));

    if (available.length === 0) {
      // reshuffle
      used = [];
      available = [...allPhrases];
    }

    // Pick random
    const phrase = available[Math.floor(Math.random() * available.length)];
    used.push(phrase);
    this.usedPhrases.set(key, used);

    return phrase;
  }
}
