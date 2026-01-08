package parser

func decodeMilesightWS101(payload []byte) *DecodedPayload {
	dp := &DecodedPayload{
		Name:   "ws101",
		Fields: make(map[string]interface{}),
		Tags:   make(map[string]interface{}),
	}

	for i := 0; i < len(payload); {
		if i+2 > len(payload) {
			break
		}
		chID, chType := payload[i], payload[i+1]
		i += 2

		switch {
		case chID == 0x01 && chType == 0x75 && i < len(payload): // Battery
			dp.Fields["battery"] = int(payload[i])
			i++
		case chID == 0xff && chType == 0x2e && i < len(payload): // Button Press
			press := "unknown"
			switch payload[i] {
			case 1:
				press = "short"
			case 2:
				press = "long"
			case 3:
				press = "double"
			}
			dp.Fields["button_press"] = press
			i++
		}
	}
	return dp
}
