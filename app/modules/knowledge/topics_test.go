package knowledge

import "testing"

// TestTopicChainParamsCoverKB 校验排查链引用的参数都在对应格式的参数知识库
// 中（拼错即失败），且 tlog 回退 apm、未知主题无链。
func TestTopicChainParamsCoverKB(t *testing.T) {
	for _, format := range []string{"apm", "ulog"} {
		pk := ForParams(format)
		for topic, chain := range formatChains[format] {
			if len(chain.Params) == 0 || chain.Guide == "" {
				t.Errorf("%s 主题 %q 排查链不完整", format, topic)
			}
			for _, p := range chain.Params {
				if _, ok := pk.Lookup(p); !ok {
					t.Errorf("%s 主题 %q 排查链参数 %q 不在参数知识库", format, topic, p)
				}
			}
		}
	}
	if c, ok := TopicChainFor("tlog", "altitude"); !ok || len(c.Params) == 0 {
		t.Error("tlog 应回退用 apm 的高度排查链")
	}
	if _, ok := TopicChainFor("ulog", "altitude"); !ok {
		t.Error("ulog 高度排查链应存在")
	}
	if _, ok := TopicChainFor("apm", "gps"); ok {
		t.Error("未定义链的主题应返回无")
	}
	if l := ChainTopics("unknown"); l != nil {
		t.Errorf("未知格式 ChainTopics 应为空，got %v", l)
	}
	if l := ChainTopics("tlog"); len(l) != len(ChainTopics("apm")) {
		t.Error("tlog ChainTopics 应与 apm 一致（回退）")
	}
}

// TestTopicGroupsCoverKB 校验主题映射表里的 group 名都在该格式知识库中
// （拼错即测试失败），且三种格式都有全部 8 个基础主题。
func TestTopicGroupsCoverKB(t *testing.T) {
	baseTopics := []string{"position", "attitude", "altitude", "power", "battery", "vibration", "estimator", "rc"}
	for _, format := range []string{"apm", "tlog", "ulog"} {
		kb := ForFormat(format)
		topics := TopicGroups(format)
		if topics == nil {
			t.Fatalf("%s: TopicGroups 为空", format)
		}
		for _, want := range baseTopics {
			if len(topics[want]) == 0 {
				t.Errorf("%s: 缺基础主题 %q", format, want)
			}
		}
		for topic, groups := range topics {
			if len(groups) == 0 {
				t.Errorf("%s: 主题 %q 映射为空", format, topic)
			}
			for _, g := range groups {
				if kb.Group(g) == nil {
					t.Errorf("%s: 主题 %q 引用的 group %q 不在知识库", format, topic, g)
				}
			}
		}
		if l := TopicList("unknown-format"); l != nil {
			t.Errorf("未知格式 TopicList 应为空，got %v", l)
		}
	}
}
