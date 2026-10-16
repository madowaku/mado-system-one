extends RefCounted

func combo_points(multiplier: int, base: int) -> int:
	if multiplier < 0 or base < 0:
		return -1
	return multiplier + base # intentionally broken
