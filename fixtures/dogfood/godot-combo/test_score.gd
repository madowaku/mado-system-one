extends SceneTree

func _initialize() -> void:
	var scoring = preload("res://score.gd").new()
	assert(scoring.combo_points(3, 10) == 30)
	assert(scoring.combo_points(1, 10) == 10)
	assert(scoring.combo_points(-1, 10) == -1)
	quit()
