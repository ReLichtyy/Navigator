import pytest
from app.services.graph_gen import validate_no_cycles, SyllabusGraph, KnowledgeNode


def test_valid_acyclic_graph() -> None:
    # A -> B -> C
    #      B -> D
    nodes = [
        KnowledgeNode(id="A", label="Topic A", dependencies=[], weight=20.0),
        KnowledgeNode(id="B", label="Topic B", dependencies=["A"], weight=30.0),
        KnowledgeNode(id="C", label="Topic C", dependencies=["B"], weight=25.0),
        KnowledgeNode(id="D", label="Topic D", dependencies=["B"], weight=25.0),
    ]
    graph = SyllabusGraph(syllabus_id="test-syllabus-1", nodes=nodes)
    assert validate_no_cycles(graph) is True


def test_direct_cycle() -> None:
    # A -> B -> A
    nodes = [
        KnowledgeNode(id="A", label="Topic A", dependencies=["B"], weight=50.0),
        KnowledgeNode(id="B", label="Topic B", dependencies=["A"], weight=50.0),
    ]
    graph = SyllabusGraph(syllabus_id="test-syllabus-2", nodes=nodes)
    
    with pytest.raises(ValueError) as exc_info:
        validate_no_cycles(graph)
    assert "Cycle detected" in str(exc_info.value)


def test_indirect_cycle() -> None:
    # A -> B -> C -> A
    nodes = [
        KnowledgeNode(id="A", label="Topic A", dependencies=["C"], weight=33.3),
        KnowledgeNode(id="B", label="Topic B", dependencies=["A"], weight=33.3),
        KnowledgeNode(id="C", label="Topic C", dependencies=["B"], weight=33.3),
    ]
    graph = SyllabusGraph(syllabus_id="test-syllabus-3", nodes=nodes)
    
    with pytest.raises(ValueError) as exc_info:
        validate_no_cycles(graph)
    assert "Cycle detected" in str(exc_info.value)


def test_disconnected_components_with_cycle() -> None:
    # Component 1 (Acyclic): A -> B
    # Component 2 (Cyclic): C -> D -> C
    nodes = [
        KnowledgeNode(id="A", label="Topic A", dependencies=[], weight=20.0),
        KnowledgeNode(id="B", label="Topic B", dependencies=["A"], weight=20.0),
        KnowledgeNode(id="C", label="Topic C", dependencies=["D"], weight=30.0),
        KnowledgeNode(id="D", label="Topic D", dependencies=["C"], weight=30.0),
    ]
    graph = SyllabusGraph(syllabus_id="test-syllabus-4", nodes=nodes)
    
    with pytest.raises(ValueError) as exc_info:
        validate_no_cycles(graph)
    assert "Cycle detected" in str(exc_info.value)


def test_missing_dependencies_does_not_raise() -> None:
    # A -> B (but B doesn't exist in nodes)
    nodes = [
        KnowledgeNode(id="A", label="Topic A", dependencies=["B"], weight=100.0),
    ]
    graph = SyllabusGraph(syllabus_id="test-syllabus-5", nodes=nodes)
    # The algorithm should tolerate missing dependencies gracefully or verify no cycle exists
    assert validate_no_cycles(graph) is True
