export type JointId = 
  | 'left_shoulder' 
  | 'right_shoulder' 
  | 'left_elbow' 
  | 'right_elbow' 
  | 'left_hip' 
  | 'right_hip' 
  | 'left_knee' 
  | 'right_knee';

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
      midMovement: ["Right knee line.", "Check right leg.", "Right knee direction."],
      afterAction: ["Make sure your right knee tracks over your toes."],
      praiseWhenFixed: ["Right knee alignment is good.", "Right leg looks strong."]
    },
    moderate: {
      midMovement: ["Straighten right leg!", "Extend right knee.", "Push through right!"],
      afterAction: ["You need to fully extend your right knee on this beat."],
      praiseWhenFixed: ["Great extension on the right.", "Perfect straight leg."]
    },
    severe: {
      midMovement: ["Lock right knee!", "Straighten the right!", "Straight right leg!"],
      afterAction: ["Your right leg is bent when it should be a perfectly straight line."],
      praiseWhenFixed: ["Beautiful straight right leg!", "Excellent extension."]
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
